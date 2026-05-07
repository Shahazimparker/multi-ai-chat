// ============================================================
// FILE: backend/services/modelCatalog.service.js
// PURPOSE: Fetch and cache live model lists for unified providers
// ============================================================

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

const cache = {
  openrouter: null,
  together: null,
  anyapi: null,
};

const now = () => Date.now();

const isFresh = (entry) => {
  return entry && entry.expiresAt > now();
};

const safeNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const isFreeOpenRouter = (model) => {
  const prompt = safeNumber(model.pricing?.prompt);
  const completion = safeNumber(model.pricing?.completion);
  const request = safeNumber(model.pricing?.request);

  return (
    model.id?.includes(':free') ||
    ((prompt === 0 || prompt === null) &&
      (completion === 0 || completion === null) &&
      (request === 0 || request === null))
  );
};

const normalizeOpenRouter = (models) => {
  return models
    .filter(m => {
      const output = m.architecture?.output_modalities || [];
      return output.includes('text') || m.architecture?.modality === 'text->text';
    })
    .map(m => ({
      id: m.id,
      label: m.name || m.id,
      paid: !isFreeOpenRouter(m),
      contextLength: m.context_length || m.top_provider?.context_length || null,
      description: m.description || '',
    }))
    .sort((a, b) => Number(a.paid) - Number(b.paid) || a.label.localeCompare(b.label));
};

const normalizeTogether = (models) => {
  return models
    .filter(m => m.type === 'chat' || m.type === 'language' || !m.type)
    .map(m => {
      const input = safeNumber(m.pricing?.input);
      const output = safeNumber(m.pricing?.output);

      return {
        id: m.id,
        label: m.display_name || m.id,
        paid: !(input === 0 && output === 0),
        contextLength: m.context_length || null,
        description: m.organization ? `By ${m.organization}` : '',
      };
    })
    .sort((a, b) => Number(a.paid) - Number(b.paid) || a.label.localeCompare(b.label));
};

const normalizeAnyAPI = (models) => {
  return models
    .map(m => ({
      id: m.id,
      label: m.id,
      paid: true,
      contextLength: null,
      description: m.owned_by ? `By ${m.owned_by}` : '',
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

const fetchJson = async (url, apiKey) => {
  const headers = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    throw new Error(`Model list fetch failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
};

const fetchOpenRouterModels = async () => {
  const data = await fetchJson(
    'https://openrouter.ai/api/v1/models',
    process.env.OPENROUTER_API_KEY
  );

  return normalizeOpenRouter(data.data || []);
};

const fetchTogetherModels = async () => {
  const data = await fetchJson(
    'https://api.together.xyz/v1/models',
    process.env.TOGETHER_API_KEY
  );

  return normalizeTogether(Array.isArray(data) ? data : data.data || []);
};

const fetchAnyAPIModels = async () => {
  const data = await fetchJson(
    'https://api.anyapi.ai/v1/models',
    process.env.ANYAPI_API_KEY
  );

  return normalizeAnyAPI(data.data || []);
};

const getProviderModels = async (provider, { refresh = false } = {}) => {
  if (!['openrouter', 'together', 'anyapi'].includes(provider)) {
    throw new Error(`Unsupported provider model list: ${provider}`);
  }

  if (!refresh && isFresh(cache[provider])) {
    return {
      provider,
      cached: true,
      models: cache[provider].models,
    };
  }

  let models;

  if (provider === 'openrouter') models = await fetchOpenRouterModels();
  if (provider === 'together') models = await fetchTogetherModels();
  if (provider === 'anyapi') models = await fetchAnyAPIModels();

  cache[provider] = {
    models,
    expiresAt: now() + CACHE_TTL_MS,
  };

  return {
    provider,
    cached: false,
    models,
  };
};

module.exports = { getProviderModels };