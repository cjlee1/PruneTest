#!/usr/bin/env python3
"""
scripts/train.py — Train a GradientBoostingClassifier on RunRecord history and export to ONNX.

Feature index contract (must match src/layers/ml/features.ts exactly):
  [0] embedding_similarity      — similarity score proxy (0-1)
  [1] graph_distance_norm       — graph distance normalized 0-1 (raw/5, capped)
  [2] historical_failure_rate   — fail_count / total_runs for this test
  [3] days_since_last_failure   — normalized 0-1 (1.0 = never failed / stale)
  [4] flakiness_score           — proxy: pass_then_fail oscillation rate
  [5] exec_time_norm            — avg duration in minutes, capped at 1.0
  [6] file_churn_rate           — distinct PRs in last 30 days / 30, capped at 1.0
  [7] author_defect_rate        — reserved, always 0.0

Usage:
    python scripts/train.py --data fixtures/runs.jsonl --output models/gbdt.onnx
"""

import argparse
import datetime
import json
import os
import sys

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from skl2onnx import to_onnx
from skl2onnx.common.data_types import FloatTensorType

try:
    import onnx  # noqa: F401 — used for pruning int64 label output
    HAS_ONNX = True
except ImportError:
    HAS_ONNX = False
    print("Warning: onnx package not available; label output will remain in model", file=sys.stderr)


# ── Constants matching features.ts ───────────────────────────────────────────
MAX_GRAPH_DISTANCE = 5.0
MAX_DAYS_SINCE_FAILURE = 365.0
CHURN_WINDOW_DAYS = 30


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Train GBDT on RunRecord history and export ONNX")
    p.add_argument("--data", required=True, help="Path to JSONL file with RunRecord rows")
    p.add_argument("--output", required=True, help="Output path for the .onnx model")
    p.add_argument("--n-estimators", type=int, default=100, help="Number of GBDT estimators")
    p.add_argument("--max-depth", type=int, default=3, help="Max tree depth")
    p.add_argument("--seed", type=int, default=42, help="Random seed")
    return p.parse_args()


def load_jsonl(path: str) -> list[dict]:
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def parse_date(s: str) -> datetime.datetime:
    """Parse ISO-8601 datetime string, handling both 'Z' and '+00:00' suffixes."""
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.datetime.fromisoformat(s)


def derive_features(runs: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """
    Derive an (N, 8) feature matrix and binary label vector from RunRecord rows.

    Each row represents one (run, test_path) pair.
    Label = 1 if test_path is in actual_failures for that run, else 0.

    Feature derivation:
      [0] embedding_similarity  — proxy: failure_rate of this test across all runs (0-1)
      [1] graph_distance_norm   — proxy: random noise seeded by test name hash (0-1)
                                  (real graph distance requires source analysis not in JSONL)
      [2] historical_failure_rate — fail_count / total_runs for this test (0-1)
      [3] days_since_last_failure — time since last observed failure, normalized
      [4] flakiness_score        — whether this test has mixed pass/fail (0 or 1)
      [5] exec_time_norm         — proxy: 0.1 (no timing data in RunRecord)
      [6] file_churn_rate        — distinct PRs in last 30 days / 30, capped 1.0
      [7] author_defect_rate     — reserved, always 0.0
    """
    # Collect per-test statistics across ALL runs first
    test_runs: dict[str, list[dict]] = {}   # test_path → list of runs that include it
    test_failures: dict[str, list[datetime.datetime]] = {}  # test_path → failure timestamps

    all_created: list[datetime.datetime] = []

    for run in runs:
        created_at = parse_date(run["created_at"])
        all_created.append(created_at)
        for test in run.get("all_tests", []):
            test_runs.setdefault(test, []).append(run)
            if test in run.get("actual_failures", []):
                test_failures.setdefault(test, []).append(created_at)

    now = max(all_created) if all_created else datetime.datetime.now(tz=datetime.timezone.utc)
    cutoff = now - datetime.timedelta(days=CHURN_WINDOW_DAYS)

    rows_X: list[list[float]] = []
    rows_y: list[int] = []

    for run in runs:
        created_at = parse_date(run["created_at"])
        for test in run.get("all_tests", []):
            label = 1 if test in run.get("actual_failures", []) else 0

            # --- feature derivation ---
            this_test_runs = test_runs.get(test, [])
            total = len(this_test_runs)
            fail_count = len(test_failures.get(test, []))

            # [2] historical failure rate
            f2 = fail_count / total if total > 0 else 0.0

            # [0] embedding similarity proxy: use failure rate as a relevance signal
            f0 = f2

            # [1] graph distance proxy: deterministic float from test path hash
            h = abs(hash(test)) % 1000
            f1 = (h % (int(MAX_GRAPH_DISTANCE) + 1)) / MAX_GRAPH_DISTANCE

            # [3] days since last failure
            past_failures = [t for t in test_failures.get(test, []) if t <= created_at]
            if past_failures:
                last_fail = max(past_failures)
                days_since = (created_at - last_fail).total_seconds() / 86400.0
                f3 = min(days_since, MAX_DAYS_SINCE_FAILURE) / MAX_DAYS_SINCE_FAILURE
            else:
                f3 = 1.0  # never failed → 1.0

            # [4] flakiness: test has both pass and fail across runs (0 or 1)
            has_pass = total > fail_count
            has_fail = fail_count > 0
            f4 = 1.0 if (has_pass and has_fail) else 0.0

            # [5] exec time (no timing data in RunRecord) — neutral proxy
            f5 = 0.1

            # [6] file churn: distinct PRs in last 30 days of this run's date
            churn_cutoff = created_at - datetime.timedelta(days=CHURN_WINDOW_DAYS)
            recent_prs = set(
                r["pr_number"]
                for r in this_test_runs
                if parse_date(r["created_at"]) >= churn_cutoff
            )
            f6 = min(len(recent_prs) / 30.0, 1.0)

            # [7] reserved — always 0.0
            f7 = 0.0

            rows_X.append([f0, f1, f2, f3, f4, f5, f6, f7])
            rows_y.append(label)

    X = np.array(rows_X, dtype=np.float32)
    y = np.array(rows_y, dtype=np.int64)
    return X, y


def train_and_export(
    X: np.ndarray,
    y: np.ndarray,
    output_path: str,
    n_estimators: int = 100,
    max_depth: int = 3,
    seed: int = 42,
) -> None:
    print(f"Training GradientBoostingClassifier on {X.shape[0]} samples, {X.shape[1]} features")
    print(f"  n_estimators={n_estimators}, max_depth={max_depth}, seed={seed}")
    print(f"  Label distribution: {int(y.sum())} positives / {len(y)} total ({100*y.mean():.1f}%)")

    clf = GradientBoostingClassifier(
        n_estimators=n_estimators,
        max_depth=max_depth,
        random_state=seed,
        learning_rate=0.1,
        subsample=0.8,
    )
    clf.fit(X, y)

    # Export to ONNX: zipmap=False → plain float arrays, not dicts
    initial_type = [("float_input", FloatTensorType([None, 8]))]
    options = {id(clf): {"zipmap": False}}
    model_proto = to_onnx(
        clf,
        X[:1],
        options=options,
        target_opset=17,
        initial_types=initial_type,
    )

    # Prune the int64 label output so onnxruntime-node only sees float32 probabilities.
    # This avoids BigInt64Array realm-mismatch errors in Jest/Node environments.
    if HAS_ONNX:
        import onnx as _onnx  # local import after guard

        prob_output = None
        for output in model_proto.graph.output:
            type_proto = output.type
            if type_proto.HasField("tensor_type"):
                # float32 = 1, int64 = 7
                if type_proto.tensor_type.elem_type == 1:
                    prob_output = output
                    break

        if prob_output is not None:
            del model_proto.graph.output[:]
            model_proto.graph.output.append(prob_output)
            print(f"Pruned to single float32 output: '{prob_output.name}'")
        else:
            print("Warning: could not find float32 output to prune", file=sys.stderr)

    # Write model
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(model_proto.SerializeToString())

    file_size = os.path.getsize(output_path)
    output_names = [o.name for o in model_proto.graph.output]
    print(f"Wrote {file_size} bytes to {output_path}")
    print(f"Output node names: {output_names}")


def main() -> None:
    args = parse_args()

    print(f"Loading RunRecord data from: {args.data}")
    runs = load_jsonl(args.data)
    print(f"Loaded {len(runs)} RunRecord rows")

    X, y = derive_features(runs)
    print(f"Derived feature matrix: {X.shape}, labels: {y.shape}")

    train_and_export(
        X, y,
        output_path=args.output,
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        seed=args.seed,
    )
    print("Done.")


if __name__ == "__main__":
    main()
