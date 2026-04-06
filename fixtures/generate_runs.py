#!/usr/bin/env python3
"""
One-off helper: generate fixtures/runs.jsonl with 200 synthetic RunRecord-shaped rows.
Called by scripts/train.py automatically; can also be run standalone.
"""
import json
import random
import datetime
import uuid
import sys
import os

def generate_runs(n: int = 200, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)

    test_paths = [
        "test/auth.test.ts",
        "test/session.test.ts",
        "test/api/users.test.ts",
        "test/api/orders.test.ts",
        "test/utils/formatter.test.ts",
        "test/utils/validator.test.ts",
        "test/components/header.test.ts",
        "test/components/footer.test.ts",
        "test/integration/db.test.ts",
        "test/integration/cache.test.ts",
    ]

    modes = ["shadow", "conservative", "standard", "aggressive"]
    base_date = datetime.datetime(2024, 1, 1, tzinfo=datetime.timezone.utc)

    records = []
    for i in range(n):
        # Spread over ~6 months
        days_offset = rng.uniform(0, 180)
        created_at = base_date + datetime.timedelta(days=days_offset)

        all_tests = rng.sample(test_paths, rng.randint(4, 10))
        # Some tests actually fail (realistic ~20% failure rate)
        num_failures = rng.choices([0, 1, 2], weights=[0.6, 0.3, 0.1])[0]
        actual_failures = rng.sample(all_tests, min(num_failures, len(all_tests)))
        # predicted_skip: model predicted these would pass (not run)
        remaining = [t for t in all_tests if t not in actual_failures]
        predicted_skip = rng.sample(remaining, min(rng.randint(0, 3), len(remaining)))

        record = {
            "id": str(uuid.UUID(int=rng.getrandbits(128))),
            "repo_id": "repo-abc123",
            "pr_number": 1000 + i,
            "sha": "%040x" % rng.getrandbits(160),
            "predicted_skip": predicted_skip,
            "actual_failures": actual_failures,
            "all_tests": all_tests,
            "mode": rng.choice(modes),
            "created_at": created_at.isoformat(),
        }
        records.append(record)

    return records


if __name__ == "__main__":
    out_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "fixtures", "runs.jsonl"
    )
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    records = generate_runs(200)
    with open(out_path, "w") as f:
        for r in records:
            f.write(json.dumps(r) + "\n")
    print(f"Wrote {len(records)} records to {out_path}")
