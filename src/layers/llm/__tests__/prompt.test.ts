// src/layers/llm/__tests__/prompt.test.ts
// Unit tests for prompt.ts — covers buildSystemPrompt, buildPrompt,
// buildRetryPrompt, and the internal truncateDiff behaviour via the public API.

import {
  buildSystemPrompt,
  buildPrompt,
  buildRetryPrompt,
  MAX_EFFECTIVE_LINES,
} from '../prompt';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a diff string with exactly `count` effective lines.
 * Each effective line is a `+line` to keep things simple.
 * Context lines (no prefix) are interspersed to make the diff realistic.
 */
function makeDiff(effectiveLines: number): string {
  const lines: string[] = ['--- a/foo.ts', '+++ b/foo.ts', '@@ -1,3 +1,3 @@'];
  for (let i = 0; i < effectiveLines; i++) {
    lines.push(`+effective line ${i}`);
  }
  return lines.join('\n');
}

/** Build a diff where all lines are context lines (no +/- prefix). */
function makeContextOnlyDiff(lineCount: number): string {
  const lines: string[] = ['--- a/foo.ts', '+++ b/foo.ts'];
  for (let i = 0; i < lineCount; i++) {
    lines.push(` context line ${i}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('buildPrompt — alphabetical ordering', () => {
  it('TC1: sorts candidates in reverse-alpha order to alpha order', () => {
    const candidates = ['z-test.ts', 'a-test.ts', 'm-test.ts'];
    const result = buildPrompt(candidates, '');
    const section = result.split('## Test Candidates')[1];
    const lines = section.trim().split('\n').filter(Boolean);
    // Strip the "medium-confidence" subtitle line
    const testLines = lines.filter((l) => l.endsWith('.ts'));
    expect(testLines).toEqual(['a-test.ts', 'm-test.ts', 'z-test.ts']);
  });

  it('TC2: already-sorted candidates remain in correct order (idempotent)', () => {
    const candidates = ['a-test.ts', 'b-test.ts', 'c-test.ts'];
    const result = buildPrompt(candidates, '');
    expect(result).toContain('a-test.ts');
    expect(result.indexOf('a-test.ts')).toBeLessThan(result.indexOf('b-test.ts'));
    expect(result.indexOf('b-test.ts')).toBeLessThan(result.indexOf('c-test.ts'));
  });

  it('TC3: empty candidates array renders without crash', () => {
    expect(() => buildPrompt([], '')).not.toThrow();
    const result = buildPrompt([], '');
    expect(result).toContain('## Test Candidates');
  });
});

describe('buildPrompt — diff truncation', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('TC4: diff with 1999 effective lines → no truncation, no console.warn', () => {
    const diff = makeDiff(1999);
    buildPrompt(['t.test.ts'], diff);
    expect(warnSpy).not.toHaveBeenCalled();
    // All 1999 effective lines should appear in the output
    const result = buildPrompt(['t.test.ts'], diff);
    const count = (result.match(/\+effective line/g) ?? []).length;
    expect(count).toBe(1999);
  });

  it('TC5: diff with exactly 2000 effective lines → no truncation, no console.warn', () => {
    const diff = makeDiff(MAX_EFFECTIVE_LINES); // 2000
    buildPrompt(['t.test.ts'], diff);
    expect(warnSpy).not.toHaveBeenCalled();
    const result = buildPrompt(['t.test.ts'], diff);
    const count = (result.match(/\+effective line/g) ?? []).length;
    expect(count).toBe(2000);
  });

  it('TC6: diff with 2001 effective lines → truncated, console.warn called with exact message', () => {
    const diff = makeDiff(2001);
    const result = buildPrompt(['t.test.ts'], diff);
    expect(warnSpy).toHaveBeenCalledWith('[LLM] Diff truncated to 2000 effective lines.');
    const count = (result.match(/\+effective line/g) ?? []).length;
    expect(count).toBe(2000);
  });

  it('TC7: empty diff string renders without crash', () => {
    expect(() => buildPrompt(['t.test.ts'], '')).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('TC8: diff with only context lines → no truncation (context lines do not count)', () => {
    // 3000 context-only lines — none should count as effective
    const diff = makeContextOnlyDiff(3000);
    buildPrompt(['t.test.ts'], diff);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('TC9: +++ and --- header lines do NOT count toward the 2000 limit', () => {
    // Build a diff that is all +++ / --- headers plus 2000 real effective lines
    const headerLines = Array.from(
      { length: 500 },
      (_, i) => (i % 2 === 0 ? `+++ header ${i}` : `--- header ${i}`),
    );
    const effectiveLines = Array.from({ length: 2000 }, (_, i) => `+real line ${i}`);
    const diff = [...headerLines, ...effectiveLines].join('\n');

    buildPrompt(['t.test.ts'], diff);
    // Should NOT have triggered truncation because headers don't count
    expect(warnSpy).not.toHaveBeenCalled();
    const result = buildPrompt(['t.test.ts'], diff);
    const realCount = (result.match(/\+real line/g) ?? []).length;
    expect(realCount).toBe(2000);
  });
});

describe('buildSystemPrompt', () => {
  it('TC10: contains the JSON_SCHEMA: sentinel', () => {
    expect(buildSystemPrompt()).toContain('JSON_SCHEMA:');
  });

  it('TC11: contains the three classification values', () => {
    const sys = buildSystemPrompt();
    expect(sys).toContain('blocking');
    expect(sys).toContain('recommended');
    expect(sys).toContain('skip');
  });

  it('TC12: contains the exact "Respond ONLY" instruction', () => {
    expect(buildSystemPrompt()).toContain('Respond ONLY with a JSON object');
  });
});

describe('buildRetryPrompt', () => {
  it('TC13: output contains "not valid JSON"', () => {
    const result = buildRetryPrompt(['t.test.ts'], '', '{"bad json');
    expect(result).toContain('not valid JSON');
  });

  it('TC14: output contains the candidate list', () => {
    const candidates = ['auth.test.ts', 'session.test.ts'];
    const result = buildRetryPrompt(candidates, '', '{}');
    expect(result).toContain('auth.test.ts');
    expect(result).toContain('session.test.ts');
  });
});

describe('buildPrompt — architecture notes', () => {
  it('TC15: non-empty architectureNotes appears in output', () => {
    const notes = 'Uses event-driven auth flow.';
    const result = buildPrompt(['t.test.ts'], '', notes);
    expect(result).toContain('## Architecture Notes');
    expect(result).toContain(notes);
  });

  it('TC16: empty/undefined architectureNotes → section omitted', () => {
    const resultEmpty = buildPrompt(['t.test.ts'], '', '');
    expect(resultEmpty).not.toContain('## Architecture Notes');

    const resultUndefined = buildPrompt(['t.test.ts'], '', undefined);
    expect(resultUndefined).not.toContain('## Architecture Notes');
  });
});
