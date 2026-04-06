// src/layers/embeddings/client.ts
// Typed REST client for the Voyage-Code-3 /v1/embeddings endpoint.
// Uses Node 20 native fetch — no SDK dependency.
// Fail-open: returns null on any error (network, 4xx/5xx, parse failure).

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// Voyage-Code-3: $0.18 per million tokens (batch rate)
const VOYAGE_COST_PER_TOKEN = 0.00000018; // $0.18 / 1_000_000

// ---------------------------------------------------------------------------
// Types (internal to embeddings layer — not shared/types.ts)
// ---------------------------------------------------------------------------

export interface EmbeddingResponse {
  embeddings: number[][];
  model: string;
  total_tokens: number;
  cost_usd: number;
}

export interface EmbedOptions {
  model?: string;
  outputDimension?: number;
  outputDtype?: 'float' | 'ubinary';
}

// Shape of the raw Voyage API response
interface VoyageAPIResponse {
  data: Array<{ embedding: number[] }>;
  model: string;
  usage: { total_tokens: number };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Embed a list of text inputs using the Voyage-Code-3 model.
 *
 * Returns an EmbeddingResponse on success, or null on any failure (fail-open).
 * API key is read from VOYAGE_API_KEY environment variable.
 */
export async function embedTexts(
  texts: string[],
  options?: EmbedOptions,
): Promise<EmbeddingResponse | null> {
  const apiKey = process.env.VOYAGE_API_KEY;

  if (!apiKey) {
    console.warn('[embeddings] VOYAGE_API_KEY not set');
    return null;
  }

  try {
    // Build request body — omit undefined fields
    const body: Record<string, unknown> = {
      input: texts,
      model: options?.model ?? 'voyage-code-3',
    };
    if (options?.outputDimension !== undefined) {
      body.output_dimension = options.outputDimension;
    }
    if (options?.outputDtype !== undefined) {
      body.output_dtype = options.outputDtype;
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(unreadable)');
      console.warn(
        `[embeddings] Voyage API error: HTTP ${response.status} — ${text}`,
      );
      return null;
    }

    const data = (await response.json()) as VoyageAPIResponse;

    const embeddings = data.data.map((item) => item.embedding);
    const totalTokens = data.usage.total_tokens;
    const costUsd = totalTokens * VOYAGE_COST_PER_TOKEN;

    return {
      embeddings,
      model: data.model,
      total_tokens: totalTokens,
      cost_usd: costUsd,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[embeddings] Voyage API error: ${msg}`);
    return null;
  }
}
