// Timeout for gateway -> agents-service HTTP calls.
//
// These were hardcoded per route (2.5s-10s), which assumes GPU-backed LLM
// inference. On a CPU-only Ollama deployment a single llama3.1 generation takes
// tens of seconds, so every AI route failed with ECONNABORTED before the model
// could answer. The per-route defaults are preserved exactly; AGENTS_TIMEOUT_MS
// raises them when set.
export const agentsTimeout = (defaultMs: number): number => {
  const raw = process.env.AGENTS_TIMEOUT_MS;
  if (!raw) return defaultMs;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
};
