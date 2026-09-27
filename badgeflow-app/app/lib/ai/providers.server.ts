// Calls the merchant's own AI provider (bring your own key) and returns a
// schema-checked reply. Claude goes through the official Anthropic SDK with
// structured outputs; OpenAI through its REST API with a strict JSON schema.
// Keys are passed in per call and never logged.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { defaultModel, isProvider, PROVIDERS, type AiProvider } from "./providers";

export { defaultModel, isProvider, PROVIDERS, type AiProvider };

// What the assistant must return every turn. Fields the model can't decide
// are null; the server validates and resolves everything before use.
export const AssistantTurn = z.strictObject({
  reply: z.string().describe("A short, friendly message to the merchant: what you drafted or what you need to know."),
  draft: z
    .strictObject({
      name: z.string().describe("Internal campaign name, e.g. 'Black Friday — Winter collection'."),
      badgeText: z.string().describe("The badge label shoppers see, at most 22 characters, e.g. 'SALE -25%'."),
      badgeColor: z.string().describe("Badge colour as a #RRGGBB hex value."),
      position: z.enum([
        "top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right",
        "bottom-left", "bottom-center", "bottom-right",
      ]),
      size: z.number().describe("Badge size as a percentage of the product image, 8 to 24. Default 12."),
      targetType: z.enum(["all", "collection", "products"]),
      collectionId: z.string().nullable().describe("For targetType 'collection': the id of one collection from the list you were given."),
      productSearch: z
        .string()
        .nullable()
        .describe("For targetType 'products': a Shopify product search query, e.g. 'tag:winter', 'vendor:Acme', 'product_type:Serum', 'title:*gift*', 'created_at:>2026-09-01'. Combine with AND / OR."),
      startNow: z.boolean().describe("True to start as soon as the merchant publishes."),
      startDate: z.string().nullable().describe("YYYY-MM-DD in the shop's timezone, when startNow is false."),
      startTime: z.string().nullable().describe("HH:mm (24h) in the shop's timezone, when startNow is false."),
      endDate: z.string().nullable().describe("YYYY-MM-DD in the shop's timezone, or null for no end."),
      endTime: z.string().nullable().describe("HH:mm (24h), or null. Use 23:59 to run to the end of the day."),
    })
    .nullable()
    .describe("The campaign draft, or null when you need more information first."),
});

export type AssistantTurnT = z.infer<typeof AssistantTurn>;
export type ChatMessage = { role: "user" | "assistant"; content: string };

// Merchant-facing failures; never includes the key or raw provider output.
export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: "auth" | "model" | "rate" | "refusal" | "invalid" | "unavailable",
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 90_000;

// OpenAI's strict mode takes plain JSON Schema without the $schema marker.
function openaiSchema() {
  const schema = { ...(z.toJSONSchema(AssistantTurn) as Record<string, unknown>) };
  delete schema.$schema;
  return schema;
}

function anthropicClient(apiKey: string) {
  return new Anthropic({ apiKey, maxRetries: 1, timeout: TIMEOUT_MS });
}

function fromAnthropicError(error: unknown): never {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    throw new AiError("Anthropic rejected this key. Check it's correct and active.", "auth");
  }
  if (error instanceof Anthropic.NotFoundError) throw new AiError("This Claude model isn't available on your key.", "model");
  if (error instanceof Anthropic.RateLimitError) {
    throw new AiError("Your Anthropic account is rate limited or out of credit. Try again later.", "rate");
  }
  if (error instanceof Anthropic.BadRequestError) {
    throw new AiError("Anthropic couldn't process that request. Check your account has API credit.", "invalid");
  }
  if (error instanceof Anthropic.APIError) throw new AiError("Anthropic is unavailable right now. Try again in a minute.", "unavailable");
  if (error instanceof Anthropic.APIConnectionError) throw new AiError("Couldn't reach Anthropic. Try again in a minute.", "unavailable");
  throw error;
}

async function openaiFetch(apiKey: string, path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(`https://api.openai.com/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AiError("Couldn't reach OpenAI. Try again in a minute.", "unavailable");
  }
  if (res.status === 401 || res.status === 403) throw new AiError("OpenAI rejected this key. Check it's correct and active.", "auth");
  if (res.status === 404) throw new AiError("This OpenAI model isn't available on your key.", "model");
  if (res.status === 429) throw new AiError("Your OpenAI account is rate limited or out of credit. Try again later.", "rate");
  if (res.status === 400) throw new AiError("OpenAI couldn't process that request.", "invalid");
  if (!res.ok) throw new AiError("OpenAI is unavailable right now. Try again in a minute.", "unavailable");
  return res.json();
}

// Cheap check that the key works and can use the model; spends no tokens.
export async function testConnection(provider: AiProvider, apiKey: string, model: string): Promise<void> {
  if (provider === "anthropic") {
    try {
      await anthropicClient(apiKey).models.retrieve(model);
    } catch (error) {
      fromAnthropicError(error);
    }
    return;
  }
  await openaiFetch(apiKey, `/models/${encodeURIComponent(model)}`);
}

export async function askAssistant(opts: {
  provider: AiProvider;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
}): Promise<AssistantTurnT> {
  const { provider, apiKey, model, system, messages } = opts;

  if (provider === "anthropic") {
    const isOpus5 = model === "claude-opus-5";
    try {
      const response = await anthropicClient(apiKey).beta.messages.parse({
        model,
        max_tokens: 8000,
        system,
        messages,
        output_config: {
          // Drafting a campaign is a small task; Haiku 4.5 doesn't take effort.
          ...(model.startsWith("claude-haiku") ? {} : { effort: "medium" as const }),
          format: betaZodOutputFormat(AssistantTurn),
        },
        // On Claude Opus 5, a safety decline is retried on a fallback model.
        ...(isOpus5 ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      if (response.stop_reason === "refusal") throw new AiError("The AI declined this request. Try rephrasing it.", "refusal");
      if (response.stop_reason === "max_tokens" || !response.parsed_output) {
        throw new AiError("The AI's answer was incomplete. Try a shorter request.", "invalid");
      }
      return response.parsed_output;
    } catch (error) {
      if (error instanceof AiError) throw error;
      fromAnthropicError(error);
    }
  }

  const body = await openaiFetch(apiKey, "/chat/completions", {
    method: "POST",
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, ...messages],
      response_format: {
        type: "json_schema",
        json_schema: { name: "assistant_turn", strict: true, schema: openaiSchema() },
      },
    }),
  });
  const choice = body?.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("The AI declined this request. Try rephrasing it.", "refusal");
  try {
    return AssistantTurn.parse(JSON.parse(choice?.message?.content ?? ""));
  } catch {
    throw new AiError("The AI's answer was incomplete. Try a shorter request.", "invalid");
  }
}
