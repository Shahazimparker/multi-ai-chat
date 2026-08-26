// ============================================================
// FILE: backend/__tests__/unit/visionExtraction.test.js
// PURPOSE: Vision extraction chain — fixed DeepSeek → Mistral → OpenRouter
//          priority, rate-limit cooldown, and the refusal to invent content.
//
//   Two invariants matter most here:
//
//   1. An unreadable image yields NULL, never a placeholder string. Whatever
//      this returns gets embedded and can be cited to the user as a verified
//      source, so "[Image: x] - could not read" must never enter the index.
//
//   2. A rate-limited provider is skipped for the rest of the burst. Ingest
//      fires many images back to back; retrying a throttled provider per image
//      costs a 429 round-trip each time AND the next provider afterwards.
// ============================================================

const dispatcher = require('../../services/ai/dispatcher.service');
const {
  extractTextFromImage,
  createVisionCallback,
  visionChain,
  clearCooldowns,
} = require('../../services/visionExtraction.service');

const IMAGE = Buffer.from('fake-png-bytes');
const reply = (text, tokensUsed = 120) => ({ text, tokensUsed });

const rateLimit = () => {
  const err = new Error('Rate limit exceeded');
  err.response = { status: 429 };
  return err;
};

const ENV_SNAPSHOT = { ...process.env };

beforeEach(() => {
  vi.restoreAllMocks();
  clearCooldowns();
  process.env = { ...ENV_SNAPSHOT };
  process.env.DEEPSEEK_API_KEY = 'test-deepseek';
  process.env.OPENROUTER_API_KEY = 'test-openrouter';
  process.env.MISTRAL_SUMMARY_API_KEY = 'test-mistral';
});

afterEach(() => {
  process.env = { ...ENV_SNAPSHOT };
  clearCooldowns();
});

describe('chain ordering', () => {
  it('runs DeepSeek first, then Mistral, then the OpenRouter models', () => {
    const chain = visionChain();
    expect(chain.map((c) => c.provider)).toEqual(['deepseek', 'mistral', 'openrouter', 'openrouter']);
    expect(chain[0].model).toBe('deepseek-v4-flash');
    expect(chain[1].model).toBe('mistral-small-latest');
    expect(chain[2].model).toBe('google/gemini-2.5-flash-lite');
    expect(chain[3].model).toBe('google/gemini-3.1-flash-lite');
  });

  it('prefers the background key but still runs on the primary one', () => {
    // Both keys are free-tier Mistral credentials; the split exists so bulk
    // ingest does not burn the quota that user-facing chat is using. So the
    // background key wins when present, but its absence must not cost the free
    // tier -- MISTRAL_API_KEY is a working fallback, not a dead one.
    delete process.env.MISTRAL_SUMMARY_API_KEY;
    process.env.MISTRAL_API_KEY = 'primary-key';
    const fallback = visionChain().find((c) => c.provider === 'mistral');
    expect(fallback.apiKey).toBe('primary-key');
    expect(fallback.tier).toBe('free');

    process.env.MISTRAL_SUMMARY_API_KEY = 'background-key';
    expect(visionChain().find((c) => c.provider === 'mistral').apiKey).toBe('background-key');
  });

  it('drops providers with no key configured', () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    expect(visionChain().every((c) => c.provider !== 'deepseek' && c.provider !== 'openrouter')).toBe(true);
  });
});

describe('extraction', () => {
  it('serves from the first provider (DeepSeek) without touching the rest', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockResolvedValue(reply('style=shape=mxgraph.flowchart.decision'));

    const { text, provider, tokensUsed } = await extractTextFromImage(IMAGE, 'image/png');

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(provider).toContain('deepseek');
    expect(text).toContain('mxgraph.flowchart.decision');
    expect(tokensUsed).toBe(120);
  });

  it('sends the image as an OpenAI-style content array', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('ok'));

    await extractTextFromImage(IMAGE, 'image/png');

    const messages = dispatch.mock.calls[0][1];
    const parts = messages[0].content;
    expect(parts.find((p) => p.type === 'image_url').image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(parts.find((p) => p.type === 'text')).toBeTruthy();
  });

  it('falls through to Mistral when DeepSeek fails', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI')
      .mockRejectedValueOnce(new Error('deepseek 500'))
      .mockResolvedValueOnce(reply('recovered text'));

    const { text, provider } = await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(provider).toContain('mistral');
    expect(text).toBe('recovered text');
  });

  it('returns null — not a placeholder — when the image has no legible content', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('NO_LEGIBLE_CONTENT'));

    const { text } = await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });

    // A placeholder here would be chunked, embedded, and citable as a source.
    expect(text).toBeNull();
  });

  it('keeps a transcription that merely mentions the no-content marker', async () => {
    // Substring matching used to throw this away: a screenshot of these very
    // sources, or of a log line, legitimately contains the token.
    const transcript = 'The service replies with exactly: NO_LEGIBLE_CONTENT when nothing is readable.';
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply(transcript));

    const { text } = await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });

    expect(text).toBe(transcript);
  });

  it('does not offer the chat tool schema on an extraction call', async () => {
    // With tools attached and tool_choice 'auto', the model can answer a slide
    // image with a generate_ppt call instead of text — a paid round-trip that
    // arrives here as an empty response and reads as a failed provider.
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('ok'));

    await extractTextFromImage(IMAGE, 'image/png');

    expect(dispatch.mock.calls[0][3]).toEqual({ disableTools: true });
  });

  it('returns null when every provider fails and OCR is off', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(new Error('everything down'));

    const { text, provider } = await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });

    expect(text).toBeNull();
    expect(provider).toBeNull();
  });

  it('propagates cancellation instead of trying the next provider', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    await expect(extractTextFromImage(IMAGE, 'image/png')).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('handles an empty buffer without calling anything', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI');
    const { text } = await extractTextFromImage(Buffer.alloc(0), 'image/png');
    expect(text).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe('rate-limit cooldown', () => {
  it('stops retrying a throttled provider across a burst of images', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockImplementation(async (cfg) => {
      if (cfg.provider === 'deepseek') throw rateLimit();
      return reply('mistral extraction');
    });

    // Five images, as a bulk ingest would send.
    for (let i = 0; i < 5; i++) {
      const { provider } = await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });
      expect(provider).toContain('mistral');
    }

    const deepseekCalls = dispatch.mock.calls.filter((c) => c[0].provider === 'deepseek');

    // Only the first image should pay the 429 round-trip; the rest skip it.
    expect(deepseekCalls).toHaveLength(1);
    expect(dispatch.mock.calls).toHaveLength(6); // 1 failed deepseek + 5 mistral
  });

  it('does not cool down a provider for an ordinary error', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockImplementation(async (cfg) => {
      if (cfg.provider === 'deepseek') throw new Error('transient 500');
      return reply('mistral extraction');
    });

    await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });
    await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });

    // A one-off failure should not disable the lead provider for the whole run.
    expect(dispatch.mock.calls.filter((c) => c[0].provider === 'deepseek')).toHaveLength(2);
  });

  it('clearCooldowns lets the throttled provider be tried again', async () => {
    const dispatch = vi.spyOn(dispatcher, 'dispatchToAI').mockImplementation(async (cfg) => {
      if (cfg.provider === 'deepseek') throw rateLimit();
      return reply('mistral extraction');
    });

    await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });
    clearCooldowns();
    await extractTextFromImage(IMAGE, 'image/png', { allowLocalOcr: false });

    expect(dispatch.mock.calls.filter((c) => c[0].provider === 'deepseek')).toHaveLength(2);
  });
});

describe('createVisionCallback', () => {
  it('adapts to the base64 signature documentLoader expects', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockResolvedValue(reply('extracted'));

    const cb = createVisionCallback({ allowLocalOcr: false });
    const out = await cb(IMAGE.toString('base64'), 'image/png');

    expect(out).toBe('extracted');
  });

  it('returns null so the loader can treat the image as unreadable', async () => {
    vi.spyOn(dispatcher, 'dispatchToAI').mockRejectedValue(new Error('down'));

    const cb = createVisionCallback({ allowLocalOcr: false });
    expect(await cb(IMAGE.toString('base64'), 'image/png')).toBeNull();
  });
});
