// src/config.ts
// Parses .testselector.yml and returns a fully-typed SelectorConfig with defaults.
// Fail-open contract: any IO or parse error → return defaults, never throw.

import * as fs from 'fs'
import * as yaml from 'js-yaml'
import { SelectorConfig } from '../shared/types'

const DEFAULT_CONFIG_PATH = '.testselector.yml'

/** Default SelectorConfig — matches PRD spec exactly. */
export const DEFAULT_CONFIG: Readonly<SelectorConfig> = {
  mode: 'shadow',
  testRunner: 'auto',
  testDir: '__tests__',
  runAllTestsOn: [
    'package.json',
    'requirements.txt',
    '*.config.ts',
    '.env*',
    '.github/workflows/**',
  ],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.40,
  fullSuiteEvery: 50,
}

/**
 * Parse a .testselector.yml file and return a SelectorConfig with defaults applied.
 *
 * @param filePath Path to the YAML config file. Defaults to '.testselector.yml'.
 * @returns A fully-typed SelectorConfig. Unknown fields are ignored. Missing or
 *          invalid files → defaults returned with a warning on stderr.
 */
export function parseConfig(filePath: string = DEFAULT_CONFIG_PATH): SelectorConfig {
  let raw: string

  // Read the file — fail-open on any IO error.
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      process.stderr.write(
        `[PruneTest] Config file not found at '${filePath}'. Using defaults.\n`,
      )
    } else {
      process.stderr.write(
        `[PruneTest] Could not read config file '${filePath}': ${String(err)}. Using defaults.\n`,
      )
    }
    return { ...DEFAULT_CONFIG, runAllTestsOn: [...DEFAULT_CONFIG.runAllTestsOn] }
  }

  // Empty file content → defaults.
  if (raw.trim() === '') {
    return { ...DEFAULT_CONFIG, runAllTestsOn: [...DEFAULT_CONFIG.runAllTestsOn] }
  }

  // Parse YAML — fail-open on parse error.
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    process.stderr.write(
      `[PruneTest] Invalid YAML in '${filePath}': ${String(err)}. Using defaults.\n`,
    )
    return { ...DEFAULT_CONFIG, runAllTestsOn: [...DEFAULT_CONFIG.runAllTestsOn] }
  }

  // yaml.load of a YAML scalar (e.g. "true", "42") returns a non-object primitive.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    process.stderr.write(
      `[PruneTest] Config file '${filePath}' did not parse to an object. Using defaults.\n`,
    )
    return { ...DEFAULT_CONFIG, runAllTestsOn: [...DEFAULT_CONFIG.runAllTestsOn] }
  }

  const user = parsed as Record<string, unknown>

  // Merge user values onto defaults. Unknown keys are silently ignored.
  // Wrong types for known keys fall back to the default value for that field.
  return {
    mode: isSelectionMode(user['mode']) ? user['mode'] : DEFAULT_CONFIG.mode,
    testRunner: isTestRunnerOrAuto(user['testRunner'] ?? user['test-runner'])
      ? (user['testRunner'] ?? user['test-runner']) as SelectorConfig['testRunner']
      : DEFAULT_CONFIG.testRunner,
    testDir: typeof user['testDir'] === 'string' || typeof user['test-dir'] === 'string'
      ? ((user['testDir'] as string | undefined) ?? (user['test-dir'] as string))
      : DEFAULT_CONFIG.testDir,
    runAllTestsOn: isStringArray(user['runAllTestsOn'] ?? user['run-all-tests-on'])
      ? [...((user['runAllTestsOn'] ?? user['run-all-tests-on']) as string[])]
      : [...DEFAULT_CONFIG.runAllTestsOn],
    alwaysRun: isStringArray(user['alwaysRun'] ?? user['always-run'])
      ? [...((user['alwaysRun'] ?? user['always-run']) as string[])]
      : DEFAULT_CONFIG.alwaysRun,
    neverRun: isStringArray(user['neverRun'] ?? user['never-run'])
      ? [...((user['neverRun'] ?? user['never-run']) as string[])]
      : DEFAULT_CONFIG.neverRun,
    architectureNotes: typeof (user['architectureNotes'] ?? user['architecture-notes']) === 'string'
      ? (user['architectureNotes'] ?? user['architecture-notes']) as string
      : DEFAULT_CONFIG.architectureNotes,
    flakyTestThreshold: typeof (user['flakyTestThreshold'] ?? user['flaky-test-threshold']) === 'number'
      ? (user['flakyTestThreshold'] ?? user['flaky-test-threshold']) as number
      : DEFAULT_CONFIG.flakyTestThreshold,
    flakyTestQuarantine: typeof (user['flakyTestQuarantine'] ?? user['flaky-test-quarantine']) === 'number'
      ? (user['flakyTestQuarantine'] ?? user['flaky-test-quarantine']) as number
      : DEFAULT_CONFIG.flakyTestQuarantine,
    fullSuiteEvery: typeof (user['fullSuiteEvery'] ?? user['full-suite-every']) === 'number'
      ? (user['fullSuiteEvery'] ?? user['full-suite-every']) as number
      : DEFAULT_CONFIG.fullSuiteEvery,
  }
}

// ── Type guards ─────────────────────────────────────────────────────────────

const VALID_MODES = new Set(['shadow', 'conservative', 'standard', 'aggressive'])
const VALID_RUNNERS = new Set(['jest', 'vitest', 'pytest', 'rspec', 'go-test', 'auto'])

function isSelectionMode(v: unknown): v is SelectorConfig['mode'] {
  return typeof v === 'string' && VALID_MODES.has(v)
}

function isTestRunnerOrAuto(v: unknown): v is SelectorConfig['testRunner'] {
  return typeof v === 'string' && VALID_RUNNERS.has(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string')
}
