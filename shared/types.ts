// shared/types.ts
// READ-ONLY for all milestones. Add to this file, never redefine elsewhere.

export interface Layer1Result {
  blocking_candidates: string[]        // test file paths with direct import trace
  run_full_suite: boolean              // true if config/critical file changed
  dependency_graph: Record<string, string[]>  // file → files it imports
  parsing_errors: string[]
  processing_time_ms: number
}

export interface Layer2Result {
  high_confidence: string[]            // >0.85 cosine sim → blocking candidates
  medium_confidence: string[]          // 0.3–0.7 → send to LLM layer
  low_confidence: string[]             // <0.3 → skip candidates
  similarity_scores: Record<string, number>
  cache_hits: number
  cache_misses: number
  api_cost_usd: number
  processing_time_ms: number
}

export interface Layer3Result {
  ranked_tests: Array<{
    path: string
    score: number                      // 0-1, higher = more likely to fail
    features_used: string[]
  }>
  model_version: string
  training_runs_available: number
  model_active: boolean                // false if <100 runs exist
  processing_time_ms: number
}

export interface Layer4Result {
  decisions: Array<{
    test_path: string
    classification: 'blocking' | 'recommended' | 'skip'
    confidence: number
    reasoning: string                  // one sentence, shown in PR comment
  }>
  llm_calls_made: number
  total_tokens_used: number
  cost_usd: number
  fallback_used: boolean
  processing_time_ms: number
}

export interface FinalSelection {
  blocking: string[]
  recommended: string[]
  skip: string[]
  mode: 'shadow' | 'conservative' | 'standard' | 'aggressive'
  overall_confidence: number
  pr_comment: string
  total_cost_usd: number
  estimated_time_saved_minutes: number
}

export interface RunRecord {
  id: string
  repo_id: string
  pr_number: number
  sha: string
  predicted_skip: string[]
  actual_failures: string[]
  all_tests: string[]
  mode: string
  created_at: Date
}

export interface TestRecord {
  repo_id: string
  path: string
  pass_count: number
  fail_count: number
  flake_score: number                  // 0-1
  last_failed_at: Date | null
  avg_duration_ms: number
}

// LLMResponse — returned by src/layers/llm/client.ts callLLM()
export interface LLMResponse {
  prompt: string
  response: string
  tokens_used: number
  cost_usd: number
  model: string
}

export type SelectionMode = 'shadow' | 'conservative' | 'standard' | 'aggressive'
export type Language = 'typescript' | 'python' | 'ruby' | 'go'
export type TestRunner = 'jest' | 'vitest' | 'pytest' | 'rspec' | 'go-test'

// Selection profiles — each defines how aggressively tests are skipped
export interface SelectionProfile {
  skipMaxPercent: number  // maximum percentage of tests that may be skipped (0–1)
}

export const SELECTION_PROFILES: Record<SelectionMode, SelectionProfile> = {
  shadow:       { skipMaxPercent: 0 },    // never skip — observe only
  conservative: { skipMaxPercent: 0.15 }, // skip ≤15%
  standard:     { skipMaxPercent: 0.50 }, // skip ≤50%
  aggressive:   { skipMaxPercent: 0.80 }, // skip ≤80%
}

// SelectorConfig mirrors the .testselector.yml schema with all defaults defined.
// READ-ONLY: never redefine this interface in another file.
export interface SelectorConfig {
  /** Selection mode — governs how aggressively tests are skipped. Default: 'shadow'. */
  mode: SelectionMode

  /** Test runner to use. 'auto' means detect from project files. Default: 'auto'. */
  testRunner: TestRunner | 'auto'

  /** Relative path to the test directory. Default: '__tests__'. */
  testDir: string

  /**
   * Glob patterns for files that trigger a full suite run when changed.
   * Default: common dependency/config files.
   */
  runAllTestsOn: string[]

  /** Test paths (or globs) that always run regardless of selection. Default: []. */
  alwaysRun: string[]

  /** Test paths (or globs) that are never run automatically. Default: []. */
  neverRun: string[]

  /**
   * Free-text architecture notes surfaced to the LLM layer.
   * The more specific, the better the LLM selection quality.
   */
  architectureNotes: string

  /**
   * Flaky-test threshold: tests failing more than this fraction of runs
   * become non-blocking. Default: 0.15 (15%).
   */
  flakyTestThreshold: number

  /**
   * Flaky-test quarantine: tests failing more than this fraction of runs
   * are auto-skipped with a warning. Default: 0.40 (40%).
   */
  flakyTestQuarantine: number

  /**
   * Backstop: force a full suite run every N PRs regardless of mode.
   * Default: 50.
   */
  fullSuiteEvery: number
}