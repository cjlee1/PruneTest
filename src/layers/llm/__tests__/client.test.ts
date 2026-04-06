// src/layers/llm/__tests__/client.test.ts
// Unit tests for callLLM() — all SDK calls are mocked.

import { callLLM } from '../client';

// ---------------------------------------------------------------------------
// Mock both SDKs at module level
// ---------------------------------------------------------------------------

const mockAnthropicCreate = jest.fn();
const mockOpenAICreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockAnthropicCreate },
    })),
  };
});

jest.mock('openai', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockOpenAICreate } },
    })),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnthropicResponse(
  text: string,
  inputTokens: number,
  outputTokens: number,
) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function makeOpenAIResponse(
  text: string,
  promptTokens: number,
  completionTokens: number,
) {
  return {
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('callLLM', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Only reset the leaf mock fns — not the constructor mocks, which are stable.
    mockAnthropicCreate.mockReset();
    mockOpenAICreate.mockReset();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -------------------------------------------------------------------------
  // Happy path: Anthropic succeeds
  // -------------------------------------------------------------------------

  it('returns LLMResponse from Anthropic on success', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = '';

    mockAnthropicCreate.mockResolvedValueOnce(
      makeAnthropicResponse('blocking', 100, 50),
    );

    const result = await callLLM('Which tests?', 'You are a test selector.');

    expect(result).not.toBeNull();
    expect(result!.response).toBe('blocking');
    expect(result!.model).toBe('claude-haiku-4-5');
    expect(result!.tokens_used).toBe(150);  // 100 + 50
    expect(result!.cost_usd).toBeGreaterThan(0);
    expect(result!.prompt).toBe('Which tests?');

    // OpenAI should NOT have been called
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Token and cost accounting (Anthropic)
  // -------------------------------------------------------------------------

  it('computes correct cost for Anthropic call', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = '';

    mockAnthropicCreate.mockResolvedValueOnce(
      makeAnthropicResponse('ok', 1_000_000, 1_000_000),
    );

    const result = await callLLM('prompt', 'system');
    expect(result).not.toBeNull();
    // $0.80/M input + $4.00/M output = $4.80 total
    expect(result!.cost_usd).toBeCloseTo(0.8 + 4.0, 5);
    expect(result!.tokens_used).toBe(2_000_000);
  });

  // -------------------------------------------------------------------------
  // OpenAI fallback path
  // -------------------------------------------------------------------------

  it('falls back to OpenAI when Anthropic throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    mockAnthropicCreate.mockRejectedValueOnce(new Error('Anthropic overloaded'));
    mockOpenAICreate.mockResolvedValueOnce(
      makeOpenAIResponse('recommended', 80, 40),
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await callLLM('Which tests?', 'system');

    expect(result).not.toBeNull();
    expect(result!.model).toBe('gpt-4o-mini');
    expect(result!.response).toBe('recommended');
    expect(result!.tokens_used).toBe(120); // 80 + 40

    // Confirm fallback warning was emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Anthropic primary call failed'),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Token and cost accounting (OpenAI)
  // -------------------------------------------------------------------------

  it('computes correct cost for OpenAI call', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    mockAnthropicCreate.mockRejectedValueOnce(new Error('fail'));
    mockOpenAICreate.mockResolvedValueOnce(
      makeOpenAIResponse('ok', 1_000_000, 1_000_000),
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await callLLM('prompt', 'system');
    expect(result).not.toBeNull();
    // $0.15/M input + $0.60/M output = $0.75 total
    expect(result!.cost_usd).toBeCloseTo(0.15 + 0.60, 5);
    expect(result!.tokens_used).toBe(2_000_000);

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Total failure → null
  // -------------------------------------------------------------------------

  it('returns null when both models fail', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    process.env.OPENAI_API_KEY = 'test-openai-key';

    mockAnthropicCreate.mockRejectedValueOnce(new Error('Anthropic down'));
    mockOpenAICreate.mockRejectedValueOnce(new Error('OpenAI down'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await callLLM('prompt', 'system');
    expect(result).toBeNull();

    // Confirm total-failure warning was emitted
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Both primary and fallback models failed'),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Env var handling — missing ANTHROPIC_API_KEY skips to OpenAI
  // -------------------------------------------------------------------------

  it('skips Anthropic and uses OpenAI when ANTHROPIC_API_KEY is absent', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = 'test-openai-key';

    mockOpenAICreate.mockResolvedValueOnce(
      makeOpenAIResponse('skip', 10, 5),
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await callLLM('p', 's');
    expect(result).not.toBeNull();
    expect(result!.model).toBe('gpt-4o-mini');
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ANTHROPIC_API_KEY not set'),
    );

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Env var handling — both keys absent → null
  // -------------------------------------------------------------------------

  it('returns null when neither API key is set', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await callLLM('p', 's');
    expect(result).toBeNull();

    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    expect(mockOpenAICreate).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
