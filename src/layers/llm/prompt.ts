// src/layers/llm/prompt.ts
// Prompt-builder functions for the LLM classification layer.
// Produces well-formed prompts with alphabetically-ordered candidates,
// diff truncated at MAX_EFFECTIVE_LINES effective +/- lines, and an
// embedded JSON classification schema.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const MAX_EFFECTIVE_LINES = 2000;

const SCHEMA_SENTINEL = 'JSON_SCHEMA:';
const SCHEMA_JSON = JSON.stringify(
  {
    decisions: [
      {
        test_path: '<string>',
        classification: 'blocking | recommended | skip',
        confidence: '<number 0-1>',
        reasoning: '<string>',
      },
    ],
  },
  null,
  2,
);

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

/**
 * Truncate a unified diff to at most MAX_EFFECTIVE_LINES effective lines.
 * Effective lines are those starting with `+` or `-` but NOT `+++` or `---`.
 * All other lines (context, headers) are included regardless and do not
 * count toward the limit.
 */
function truncateDiff(diff: string): { truncated: string; wasTruncated: boolean } {
  if (!diff) {
    return { truncated: diff, wasTruncated: false };
  }

  const lines = diff.split('\n');
  const kept: string[] = [];
  let effectiveLines = 0;
  let wasTruncated = false;

  for (const line of lines) {
    // Determine whether this line counts as an effective line.
    const isEffective =
      (line.startsWith('+') || line.startsWith('-')) &&
      !line.startsWith('+++') &&
      !line.startsWith('---');

    if (isEffective) {
      if (effectiveLines >= MAX_EFFECTIVE_LINES) {
        // We have already hit the limit; skip the rest.
        wasTruncated = true;
        continue;
      }
      effectiveLines++;
    }

    kept.push(line);
  }

  return { truncated: kept.join('\n'), wasTruncated };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the static system prompt that instructs the LLM to classify
 * medium-confidence test candidates as blocking, recommended, or skip.
 * Embeds the full JSON schema after a `JSON_SCHEMA:` sentinel line.
 */
export function buildSystemPrompt(): string {
  return [
    'You are a senior software engineer helping to classify test candidates.',
    '',
    'Your task is to classify medium-confidence test candidates (similarity 0.3–0.7)',
    'as one of three categories based on semantic intent and behavior:',
    '  • blocking    — must run (high semantic overlap with the change)',
    '  • recommended — should run (moderate semantic overlap)',
    '  • skip        — safe to skip (low semantic overlap)',
    '',
    'Rules:',
    '  1. Base decisions on semantic intent and behavior, not file structure or imports.',
    '  2. Respond ONLY with a JSON object matching this exact schema.',
    '     No markdown, no explanation, no code fences.',
    '',
    SCHEMA_SENTINEL,
    SCHEMA_JSON,
  ].join('\n');
}

/**
 * Builds the user-facing classification prompt for the given candidates and diff.
 *
 * @param candidates  Test file paths to classify (sorted alphabetically inside).
 * @param diff        Unified diff of the change (truncated if > 2000 effective lines).
 * @param architectureNotes  Optional free-text architecture context; section omitted if empty.
 */
export function buildPrompt(
  candidates: string[],
  diff: string,
  architectureNotes?: string,
): string {
  const sorted = [...candidates].sort();

  const { truncated, wasTruncated } = truncateDiff(diff);
  if (wasTruncated) {
    console.warn('[LLM] Diff truncated to 2000 effective lines.');
  }

  const sections: string[] = [];

  if (architectureNotes && architectureNotes.trim().length > 0) {
    sections.push(`## Architecture Notes\n${architectureNotes.trim()}`);
  }

  sections.push(`## Code Diff (showing changed behavior)\n${truncated}`);

  sections.push(
    `## Test Candidates (medium-confidence — classify each)\n${sorted.join('\n')}`,
  );

  return sections.join('\n\n');
}

/**
 * Builds a retry prompt when the LLM returned invalid JSON.
 * Prepends the error context and the re-embedded schema, then appends
 * the normal candidate/diff section from `buildPrompt()`.
 */
export function buildRetryPrompt(
  candidates: string[],
  diff: string,
  previousResponse: string,
  architectureNotes?: string,
): string {
  const truncatedPrevious = previousResponse.slice(0, 500);

  const header = [
    'Your previous response was not valid JSON.',
    'Respond ONLY with a JSON object matching this exact schema.',
    'Do not include any markdown, explanation, or code fences.',
    '',
    'Previous response:',
    truncatedPrevious,
    '',
    SCHEMA_SENTINEL,
    SCHEMA_JSON,
  ].join('\n');

  const body = buildPrompt(candidates, diff, architectureNotes);

  return `${header}\n\n${body}`;
}
