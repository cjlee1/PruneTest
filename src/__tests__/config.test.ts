// src/__tests__/config.test.ts
// Comprehensive unit tests for parseConfig() covering all branches and defaults.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { parseConfig, DEFAULT_CONFIG } from '../config'
import { SelectorConfig } from '../../shared/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Write content to a temp file and return its path. */
function writeTempFile(content: string, ext = '.yml'): string {
  const tmp = path.join(os.tmpdir(), `testselector-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`)
  fs.writeFileSync(tmp, content, 'utf-8')
  return tmp
}

/** Suppress stderr during a callback and return the captured text. */
function captureStderr(fn: () => SelectorConfig): { result: SelectorConfig; stderr: string } {
  const original = process.stderr.write.bind(process.stderr)
  let captured = ''
  process.stderr.write = (chunk: string | Uint8Array): boolean => {
    captured += chunk.toString()
    return true
  }
  try {
    const result = fn()
    return { result, stderr: captured }
  } finally {
    process.stderr.write = original
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parseConfig()', () => {
  // (a) Missing file → defaults + stderr warning
  test('missing file returns defaults and emits a warning', () => {
    const { result, stderr } = captureStderr(() =>
      parseConfig('/nonexistent/path/.testselector.yml')
    )
    expect(result).toEqual(expect.objectContaining({
      mode: 'shadow',
      testRunner: 'auto',
      testDir: '__tests__',
      flakyTestThreshold: 0.15,
      flakyTestQuarantine: 0.40,
      fullSuiteEvery: 50,
    }))
    expect(stderr).toMatch(/not found/i)
  })

  // (b) Empty file → defaults (no throw)
  test('empty file returns defaults', () => {
    const tmp = writeTempFile('')
    try {
      const result = parseConfig(tmp)
      expect(result.mode).toBe('shadow')
      expect(result.fullSuiteEvery).toBe(50)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // (c) Partial config → missing fields filled from defaults
  test('partial config merges with defaults', () => {
    const tmp = writeTempFile('mode: aggressive\ntestDir: tests')
    try {
      const result = parseConfig(tmp)
      expect(result.mode).toBe('aggressive')
      expect(result.testDir).toBe('tests')
      // Unspecified fields should still be defaults
      expect(result.flakyTestThreshold).toBe(0.15)
      expect(result.fullSuiteEvery).toBe(50)
      expect(result.alwaysRun).toEqual([])
      expect(result.neverRun).toEqual([])
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // (d) Full valid config → exact values returned
  test('full config returns exact values', () => {
    const content = [
      'mode: conservative',
      'testRunner: jest',
      'testDir: src/__tests__',
      'run-all-tests-on:',
      '  - package.json',
      '  - Dockerfile',
      'always-run:',
      '  - __tests__/smoke.test.ts',
      'never-run:',
      '  - __tests__/integration/**',
      'architecture-notes: "Auth lives in src/auth"',
      'flaky-test-threshold: 0.20',
      'flaky-test-quarantine: 0.50',
      'full-suite-every: 100',
    ].join('\n')
    const tmp = writeTempFile(content)
    try {
      const result = parseConfig(tmp)
      expect(result.mode).toBe('conservative')
      expect(result.testRunner).toBe('jest')
      expect(result.testDir).toBe('src/__tests__')
      expect(result.runAllTestsOn).toEqual(['package.json', 'Dockerfile'])
      expect(result.alwaysRun).toEqual(['__tests__/smoke.test.ts'])
      expect(result.neverRun).toEqual(['__tests__/integration/**'])
      expect(result.architectureNotes).toBe('Auth lives in src/auth')
      expect(result.flakyTestThreshold).toBe(0.20)
      expect(result.flakyTestQuarantine).toBe(0.50)
      expect(result.fullSuiteEvery).toBe(100)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // (e) Invalid YAML → defaults + stderr warning (R016, R018, R019)
  test('invalid YAML returns defaults and emits a warning', () => {
    const tmp = writeTempFile('mode: shadow\n  bad: indent:\n    - broken\n  yaml: [unclosed')
    try {
      const { result, stderr } = captureStderr(() => parseConfig(tmp))
      expect(result.mode).toBe('shadow')
      expect(result.fullSuiteEvery).toBe(50)
      expect(stderr).toMatch(/invalid yaml/i)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // (f) Default mode is 'shadow' — D007, R018
  test("default mode is 'shadow' (R018, D007)", () => {
    const { result } = captureStderr(() =>
      parseConfig('/no/such/file.yml')
    )
    expect(result.mode).toBe('shadow')
  })

  // (g) fullSuiteEvery default is 50 — R019
  test('fullSuiteEvery default is 50 (R019)', () => {
    const tmp = writeTempFile('mode: standard')
    try {
      expect(parseConfig(tmp).fullSuiteEvery).toBe(50)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // (h) flakyTestThreshold=0.15 and flakyTestQuarantine=0.40 — R016
  test('flakyTestThreshold default is 0.15 and flakyTestQuarantine default is 0.40 (R016)', () => {
    const tmp = writeTempFile('mode: standard')
    try {
      const result = parseConfig(tmp)
      expect(result.flakyTestThreshold).toBe(0.15)
      expect(result.flakyTestQuarantine).toBe(0.40)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // ── Negative Tests ────────────────────────────────────────────────────────

  // Malformed: file path points to a directory
  test('directory path (EISDIR) returns defaults with warning', () => {
    const { result, stderr } = captureStderr(() => parseConfig(os.tmpdir()))
    expect(result).toMatchObject(DEFAULT_CONFIG)
    expect(stderr).toMatch(/could not read/i)
  })

  // Malformed: unknown extra keys are silently ignored (no error, no crash)
  test('unknown extra keys are ignored and do not cause errors', () => {
    const tmp = writeTempFile('mode: shadow\nfutureOption: true\nrandomField: 42')
    try {
      const result = parseConfig(tmp)
      expect(result.mode).toBe('shadow')
      // futureOption should not appear on the result
      expect((result as unknown as Record<string, unknown>)['futureOption']).toBeUndefined()
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // Malformed: wrong types for known keys fall back to defaults
  test('wrong type for mode falls back to default', () => {
    const tmp = writeTempFile('mode: 42\nfullSuiteEvery: "not-a-number"')
    try {
      const result = parseConfig(tmp)
      expect(result.mode).toBe('shadow')          // default
      expect(result.fullSuiteEvery).toBe(50)      // default
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // Malformed: YAML that parses to a non-object (scalar) falls back to defaults
  test('YAML scalar document returns defaults', () => {
    const tmp = writeTempFile('42')
    try {
      const { result } = captureStderr(() => parseConfig(tmp))
      expect(result.mode).toBe('shadow')
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // Malformed: binary-like garbage in YAML falls back to defaults
  test('binary-like garbage YAML returns defaults and emits warning', () => {
    // Inject a YAML tab-in-flow-scalar error which js-yaml cannot parse
    const tmp = writeTempFile('key: [unclosed bracket, missing\nbad\t:indent')
    try {
      const { result, stderr } = captureStderr(() => parseConfig(tmp))
      expect(result.mode).toBe('shadow')
      expect(stderr.length).toBeGreaterThan(0)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  // Verify returned object is a copy — mutations don't affect DEFAULT_CONFIG
  test('returned config is a independent copy — mutation does not affect DEFAULT_CONFIG', () => {
    const { result } = captureStderr(() => parseConfig('/no/such/file.yml'))
    result.runAllTestsOn.push('injected')
    expect(DEFAULT_CONFIG.runAllTestsOn).not.toContain('injected')
  })
})
