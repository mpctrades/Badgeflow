// AI providers and models merchants can pick in Settings. Shared by the
// browser (Settings form) and the server (validation, API calls).
export type AiProvider = "anthropic" | "openai";

export const PROVIDERS: Record<AiProvider, { label: string; models: { id: string; label: string }[]; keyHelp: string }> = {
  anthropic: {
    label: "Claude (Anthropic)",
    models: [
      { id: "claude-opus-5", label: "Claude Opus 5 (best results)" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5 (cheaper)" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (cheapest)" },
    ],
    keyHelp: "Create a key at console.anthropic.com → API keys.",
  },
  openai: {
    label: "OpenAI",
    models: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini (cheaper)" },
    ],
    keyHelp: "Create a key at platform.openai.com → API keys.",
  },
};

export function isProvider(value: unknown): value is AiProvider {
  return value === "anthropic" || value === "openai";
}

export function defaultModel(provider: AiProvider): string {
  return PROVIDERS[provider].models[0]!.id;
}
