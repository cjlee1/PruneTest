// src/layers/llm/pr-classifier.ts
// Heuristic classifier that infers whether a diff is primarily a new-feature
// addition or a bugfix / modification.  Used by the orchestrator to decide
// whether to force Conservative mode when Layer 4 fires.

/**
 * Classify a unified diff as 'feature', 'bugfix', or 'unknown'.
 *
 * Feature detection: lines starting with `+` (but not `+++`) that introduce
 * new top-level definitions:
 *   +function …, +const X = (, +class …, +export function …,
 *   +export const …, +export class …
 *
 * Bugfix detection: lines starting with `-` (but not `---`) that do NOT match
 * the feature patterns — these represent deletions / modifications.
 *
 * Decision rule:
 *   - Both counts zero / empty diff → 'unknown'
 *   - newDefinitionCount > modificationCount  → 'feature'
 *   - otherwise                               → 'bugfix'
 */
export function classifyDiffType(diff: string): 'feature' | 'bugfix' | 'unknown' {
  if (diff.trim() === '') {
    return 'unknown';
  }

  const featurePattern =
    /^\+(?:(?:export\s+)?(?:function|class)\s|(?:export\s+)?const\s+\w+\s*=\s*\()/;

  let newDefinitionCount = 0;
  let modificationCount = 0;

  for (const line of diff.split('\n')) {
    // Addition lines (but not file-header `+++`)
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (featurePattern.test(line)) {
        newDefinitionCount++;
      }
    }

    // Deletion lines (but not file-header `---`) that are NOT feature additions
    if (line.startsWith('-') && !line.startsWith('---')) {
      modificationCount++;
    }
  }

  if (newDefinitionCount === 0 && modificationCount === 0) {
    return 'unknown';
  }

  return newDefinitionCount > modificationCount ? 'feature' : 'bugfix';
}
