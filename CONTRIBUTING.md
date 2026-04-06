# Contributing

Thanks for your interest. This is an open-source project and contributions are welcome.

## Ground rules

- **Fail-open always.** Any layer failure → log warning, continue. Never exit non-zero due to pipeline errors. Never block CI.
- **`shared/types.ts` is the interface contract.** All inter-layer data structures live there. If a new type crosses layer boundaries, add it to `shared/types.ts` — don't define it locally.
- **Alphabetical ordering on all LLM inputs.** Changed files, test candidates, dependency info — sorted.
- **Every exported function has a unit test.** `npm run test` must pass before any PR is merged.
- **Zero TypeScript errors.** `npm run typecheck` must be clean.
- **Zero lint errors.** `npm run lint` must be clean.

## Setup

```bash
git clone https://github.com/cjlee1/Skippr.git
cd Skippr
cp .env.example .env   # fill in ANTHROPIC_API_KEY and VOYAGE_API_KEY at minimum
npm install
npm run typecheck
npm run lint
npm run test
```

For dashboard development:

```bash
cd dashboard
cp .env.local.example .env.local
npm install
npm run dev
```

## Verification before submitting a PR

```bash
npm run typecheck   # zero errors
npm run lint        # zero warnings
npm run test        # all tests pass

# also run dashboard tests if you touched dashboard/
cd dashboard && npm run typecheck && npm run test
```

## What to work on

The project tracks planned work in [PROJECTS.md](PROJECTS.md). Good first issues are usually:

- Additional language parsers (Java, Rust, C#) in `src/layers/static-analysis/parsers/`
- Improving the GBDT feature set in `src/layers/ml/features.ts`
- Dashboard UI polish in `dashboard/src/app/`

For large changes — new layers, new config options, changes to `shared/types.ts` — open an issue first to align on direction before writing code.

## Commit style

Conventional commits preferred:

```
feat: add Java import parser
fix: handle empty diff in Layer 2
chore: update onnxruntime-node to 1.23.1
docs: add dashboard self-hosting guide
```

## Licence

By contributing, you agree your contributions are licensed under the project's [MIT licence](LICENSE).
