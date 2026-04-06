# Skippr

[![CI](https://github.com/cjlee1/Skippr/actions/workflows/ci.yml/badge.svg)](https://github.com/cjlee1/Skippr/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

ML-backed CI test selection — run only the tests that matter for your diff.

Uses static import analysis, semantic embeddings (Voyage-Code-3), a GBDT model, and an optional LLM reasoning layer to decide which tests to skip on each pull request. Ships as a GitHub Actions composite action.

---

## How it works

1. **Layer 1 — Static analysis**: builds a file dependency graph from your imports (TypeScript, JavaScript, Python, Ruby, Go) using tree-sitter. Tests that don't transitively depend on any changed file are immediate skip candidates.
2. **Layer 2 — Embeddings**: uses Voyage-Code-3 to score semantic similarity between the diff and each test. High-confidence matches block; low-confidence are skipped; medium-confidence go to Layer 4.
3. **Layer 3 — GBDT ML**: activates after 100 run records. Scores candidates using an ONNX gradient-boosted model trained on your repo's own history.
4. **Layer 4 — LLM reasoning**: fires only on the medium-confidence band (similarity 0.3–0.7). Asks the LLM "what is the developer's intent, and which tests exercise this behaviour?" — never asks it to trace imports.

All layers are fail-open: any layer failure produces a warning and falls through. CI is never blocked by the tool itself.

---

## Quick start

### 1. Add to your workflow

```yaml
# .github/workflows/test.yml
- name: Select tests
  id: selector
  uses: cjlee1/Skippr@main
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    mode: shadow            # start in shadow — observe before skipping
    project-token: ${{ secrets.TESTSELECTOR_TOKEN }}

- name: Run selected tests
  run: npx jest ${{ steps.selector.outputs.blocking-tests }}
```

### 2. Provision a token

```bash
NEON_DATABASE_URL=<your-neon-url> REPO_ID=org/repo \
  node dashboard/scripts/provision-token.mjs
```

Copy the printed raw token and add it as `TESTSELECTOR_TOKEN` in your repository secrets.

### 3. Shadow mode

The tool starts in `shadow` mode by default — it selects tests internally but still runs the full suite and records outcomes. After 50 runs it prints an accuracy report. Flip to `standard` once you're satisfied.

---

## Self-hosting the dashboard

The optional dashboard gives you a per-repo view of shadow progress, flaky test rankings, accuracy trends, and CI savings.

**Prerequisites:** [Neon](https://neon.tech) (Postgres), [ClickHouse Cloud](https://clickhouse.com/cloud) (run storage).

```bash
cd dashboard
cp .env.local.example .env.local   # fill in Neon + ClickHouse credentials
npm install
npx drizzle-kit push                # apply schema to Neon
npm run dev                         # http://localhost:3000
```

Email alerts are optional. Set `SMTP_HOST` and related vars in `.env.local` and install `nodemailer`:

```bash
npm install nodemailer
```

Leave `SMTP_HOST` blank to use console-only fallback (useful for dev and OSS installs that don't need email).

---

## Configuration

Create `.testselector.yml` at your repo root:

```yaml
mode: shadow            # shadow | standard | conservative | aggressive
full-suite-every: 50    # force full suite every N PRs (backstop)
test-runner: jest       # jest | pytest | rspec | go-test
quarantine-threshold: 0.3  # skip tests with flake score above this
```

All fields are optional — the action works with zero config.

---

## Architecture

```
PR diff
  │
  ▼
Layer 1: Static analysis (tree-sitter import graph)
  │   high-confidence skip candidates
  ▼
Layer 2: Embedding similarity (Voyage-Code-3)
  │   similarity > 0.85 → blocking
  │   similarity 0.3–0.7 → medium → Layer 4
  │   similarity < 0.3 → skip
  ▼
Layer 3: GBDT ML (activates after 100 runs)
  │   re-scores candidates using repo history
  ▼
Layer 4: LLM reasoning (Haiku / GPT-4o-mini)
  │   semantic intent only — no import tracing
  ▼
Merger: applies profile cap, quarantine filter
  │
  ▼
blocking-tests / skip-tests / recommended-tests
```

---

## Enterprise

Running this at scale — 1 000+ repos, SOC 2 requirements, custom model training? See [enterprise inquiry →](https://github.com/cjlee1/Skippr) or email [calvinlee@cjlee.ca](mailto:calvinlee@cjlee.ca).

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Attribution

Built by [Calvin Lee](https://github.com/cjlee1). MIT licence.

If this tool saves your team time, consider [sponsoring on GitHub](https://github.com/sponsors/cjlee1) ♥
