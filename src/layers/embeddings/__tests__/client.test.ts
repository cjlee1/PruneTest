// src/layers/embeddings/__tests__/client.test.ts
// Unit tests for embedTexts() — all fetch calls are mocked.

import { embedTexts } from '../client';

// ---------------------------------------------------------------------------
// Mock global fetch
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVoyageResponse(
  embeddings: number[][],
  model: string,
  totalTokens: number,
): object {
  return {
    data: embeddings.map((embedding) => ({ embedding })),
    model,
    usage: { total_tokens: totalTokens },
  };
}

function makeOkResponse(body: object): Response {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function makeErrorResponse(status: number, bodyText: string): Response {
  return {
    ok: false,
    status,
    json: jest.fn().mockRejectedValue(new Error('not json')),
    text: jest.fn().mockResolvedValue(bodyText),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('embedTexts', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockFetch.mockReset();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns EmbeddingResponse with correct shape on success', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';

    const fakeEmbeddings = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];
    const voyageBody = makeVoyageResponse(fakeEmbeddings, 'voyage-code-3', 1000);
    mockFetch.mockResolvedValueOnce(makeOkResponse(voyageBody));

    const result = await embedTexts(['hello world', 'foo bar']);

    expect(result).not.toBeNull();
    expect(result!.embeddings).toEqual(fakeEmbeddings);
    expect(result!.model).toBe('voyage-code-3');
    expect(result!.total_tokens).toBe(1000);
    // $0.18/million * 1000 tokens = 0.00000018 * 1000 = 0.00018
    expect(result!.cost_usd).toBeCloseTo(0.00018, 10);
  });

  it('computes cost_usd correctly for zero tokens', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';

    const voyageBody = makeVoyageResponse([[0.1, 0.2]], 'voyage-code-3', 0);
    mockFetch.mockResolvedValueOnce(makeOkResponse(voyageBody));

    const result = await embedTexts(['x']);
    expect(result).not.toBeNull();
    expect(result!.cost_usd).toBe(0);
    expect(result!.total_tokens).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Missing API key
  // -------------------------------------------------------------------------

  it('returns null and warns when VOYAGE_API_KEY is not set', async () => {
    delete process.env.VOYAGE_API_KEY;
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await embedTexts(['hello']);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('[embeddings] VOYAGE_API_KEY not set');

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Network / fetch throws
  // -------------------------------------------------------------------------

  it('returns null and warns on network error', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await embedTexts(['hello']);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[embeddings] Voyage API error:'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ECONNREFUSED'),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // 4xx response
  // -------------------------------------------------------------------------

  it('returns null and warns on 4xx response', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce(makeErrorResponse(401, 'Unauthorized'));

    const result = await embedTexts(['hello']);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[embeddings] Voyage API error:'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('401'));

    warnSpy.mockRestore();
  });

  it('returns null and warns on 5xx response', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Internal Server Error'));

    const result = await embedTexts(['hello']);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[embeddings] Voyage API error:'),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('500'));

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Malformed JSON
  // -------------------------------------------------------------------------

  it('returns null and warns on malformed JSON response', async () => {
    process.env.VOYAGE_API_KEY = 'test-voyage-key';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      text: jest.fn().mockResolvedValue('not json at all'),
    } as unknown as Response);

    const result = await embedTexts(['hello']);

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[embeddings] Voyage API error:'),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Correct request body / headers
  // -------------------------------------------------------------------------

  it('calls fetch with correct URL, method, Authorization header, and default body', async () => {
    process.env.VOYAGE_API_KEY = 'my-secret-key';

    const voyageBody = makeVoyageResponse([[0.1]], 'voyage-code-3', 5);
    mockFetch.mockResolvedValueOnce(makeOkResponse(voyageBody));

    await embedTexts(['test input']);

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer my-secret-key',
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.input).toEqual(['test input']);
    expect(body.model).toBe('voyage-code-3');
    // outputDimension and outputDtype should be absent (not set to undefined)
    expect(body.output_dimension).toBeUndefined();
    expect(body.output_dtype).toBeUndefined();
  });

  it('includes output_dimension and output_dtype when provided in options', async () => {
    process.env.VOYAGE_API_KEY = 'my-secret-key';

    const voyageBody = makeVoyageResponse([[0.1]], 'voyage-code-3', 5);
    mockFetch.mockResolvedValueOnce(makeOkResponse(voyageBody));

    await embedTexts(['test'], { model: 'voyage-code-3', outputDimension: 256, outputDtype: 'ubinary' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body.output_dimension).toBe(256);
    expect(body.output_dtype).toBe('ubinary');
    expect(body.model).toBe('voyage-code-3');
  });

  it('uses custom model when specified in options', async () => {
    process.env.VOYAGE_API_KEY = 'my-secret-key';

    const voyageBody = makeVoyageResponse([[0.1]], 'voyage-code-2-code', 5);
    mockFetch.mockResolvedValueOnce(makeOkResponse(voyageBody));

    await embedTexts(['test'], { model: 'voyage-code-2-code' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('voyage-code-2-code');
  });
});
