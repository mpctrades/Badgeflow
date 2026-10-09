// The BadgeFlow AI assistant: turns a merchant's plain-language request into
// a campaign draft, using the merchant's own AI key. It only ever proposes a
// draft — saving it (as a draft) and publishing are separate merchant actions.
import db from "../../db.server";
import { BADGE_PRESETS, claimWarning } from "../badges";
import { PLANS, productCount, type PlanId } from "../campaign";
import { utcToZoned, zonedToUtc } from "../timezone";
import { fetchShopInfo } from "../shopify-catalog.server";
import { decryptSecret } from "./crypto.server";
import { AiError, askAssistant, isProvider, type AssistantTurnT, type ChatMessage } from "./providers.server";

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

export function planHasAi(plan: string): boolean {
  return plan === "premium" || plan === "unlimited";
}

const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 2000;
const MAX_REQUESTS_PER_HOUR = 40;
const usage = new Map<string, number[]>();

function rateLimited(shop: string): boolean {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = (usage.get(shop) ?? []).filter((t) => t > hourAgo);
  if (recent.length >= MAX_REQUESTS_PER_HOUR) {
    usage.set(shop, recent);
    return true;
  }
  usage.set(shop, [...recent, Date.now()]);
  return false;
}

type CollectionRef = { id: string; title: string; count: number };

async function listCollections(admin: AdminGraphqlClient): Promise<CollectionRef[]> {
  try {
    const res = await admin.graphql(`#graphql
      query BadgeFlowAiCollections { collections(first: 100, sortKey: TITLE) { nodes { id title productsCount { count } } } }`);
    const body = await res.json();
    return ((body?.data?.collections?.nodes ?? []) as { id: string; title: string; productsCount?: { count: number } }[]).map(
      (c) => ({ id: c.id, title: c.title, count: c.productsCount?.count ?? 0 }),
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    return [];
  }
}

async function searchProducts(admin: AdminGraphqlClient, search: string): Promise<{ id: string; title: string }[]> {
  try {
    const res = await admin.graphql(
      `#graphql
        query BadgeFlowAiProductSearch($query: String!) { products(first: 250, query: $query, sortKey: TITLE) { nodes { id title } } }`,
      { variables: { query: search } },
    );
    const body = await res.json();
    return (body?.data?.products?.nodes ?? []) as { id: string; title: string }[];
  } catch (error) {
    if (error instanceof Response) throw error;
    return [];
  }
}

export type ResolvedDraft = {
  name: string;
  badgeText: string;
  badgeColor: string;
  position: string;
  size: number;
  targetType: "all" | "collection" | "products";
  targetRef: string;
  targetLabel: string;
  targetCount: number | null;
  sampleTitles: string[];
  // How the target was chosen, so follow-up turns can refine it.
  collectionId: string | null;
  productSearch: string | null;
  startNow: boolean;
  startDate: string;
  startTime: string;
  hasEnd: boolean;
  endDate: string;
  endTime: string;
  warning: string | null;
};

function systemPrompt(ctx: {
  shopName: string;
  timezone: string;
  now: { date: string; time: string };
  plan: PlanId;
  collections: CollectionRef[];
}): string {
  const plan = PLANS[ctx.plan];
  const collections = ctx.collections.length
    ? ctx.collections.map((c) => `- ${c.title} (id: ${c.id}, ${c.count} products)`).join("\n")
    : "- (none)";
  return `You are the campaign assistant inside BadgeFlow, a Shopify app that shows badges (short labels like "SALE -30%" or "NEW") on product images for a scheduled time.

Your job: turn the merchant's request into one campaign draft, or ask a short question when something important is missing. You never publish; the merchant reviews and publishes the draft themselves.

Store: ${ctx.shopName}. Timezone: ${ctx.timezone}. Right now it is ${ctx.now.date} ${ctx.now.time} there. Interpret all dates and times in this timezone and write them as YYYY-MM-DD and HH:mm. Resolve relative dates ("this weekend", "Black Friday") to real dates.

Plan: ${plan.label} — badges on ${plan.limit === Infinity ? "unlimited" : plan.limit} products.

Targeting options:
- "all": every product.
- "collection": one collection from this list, by id:
${collections}
- "products": a Shopify product search query in productSearch, using fields like title, tag, vendor, product_type, created_at (e.g. "tag:winter AND vendor:Acme", "created_at:>2026-09-01", "title:*gift*").

BadgeFlow can't see inventory levels or sales data. If the merchant asks for "best sellers", "low stock" or similar, explain briefly that BadgeFlow can't detect that and target a collection or tag they name instead, or ask which products they mean. Don't invent products or collections.

Badge text must be short (at most 22 characters). Suggested colours: ${[...new Set(BADGE_PRESETS.map((p) => p.color))].join(", ")} (red for sales, green for new, gold for holidays). Default position top-left, default size 12.

When the conversation includes a "Current draft", apply the merchant's changes to it and return the full updated draft. Keep "reply" to one or two sentences, in the merchant's language.`;
}

const HEX = /^#[0-9a-f]{6}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

async function resolveDraft(
  admin: AdminGraphqlClient,
  draft: NonNullable<AssistantTurnT["draft"]>,
  collections: CollectionRef[],
  timezone: string,
  today: string,
): Promise<{ draft: ResolvedDraft | null; notes: string[] }> {
  const notes: string[] = [];
  const badgeText = draft.badgeText.trim().slice(0, 22) || "SALE";
  let targetType = draft.targetType;
  let targetRef = "";
  let targetLabel = "All products";
  let targetCount: number | null = null;
  let sampleTitles: string[] = [];

  if (targetType === "collection") {
    const c = collections.find((x) => x.id === draft.collectionId);
    if (!c) {
      notes.push("I couldn't match that collection, so the draft targets all products — change it in the builder.");
      targetType = "all";
    } else {
      targetRef = c.id;
      targetLabel = `${c.title} — ${productCount(c.count)}`;
      targetCount = c.count;
    }
  } else if (targetType === "products") {
    const search = (draft.productSearch ?? "").trim().slice(0, 300);
    const found = search ? await searchProducts(admin, search) : [];
    if (!found.length) {
      notes.push(`No products matched "${search || "that description"}". Try naming a collection, tag or product title.`);
      return { draft: null, notes };
    }
    targetRef = found.map((p) => p.id).join(",");
    targetLabel = `${found.length} product${found.length === 1 ? "" : "s"}`;
    targetCount = found.length;
    sampleTitles = found.slice(0, 5).map((p) => p.title);
    if (found.length === 250) notes.push("Only the first 250 matching products are included.");
  }

  let startNow = draft.startNow;
  let startDate = draft.startDate && DATE.test(draft.startDate) ? draft.startDate : today;
  let startTime = draft.startTime && TIME.test(draft.startTime) ? draft.startTime : "00:00";
  if (!startNow && !zonedToUtc(startDate, startTime, timezone)) {
    notes.push("The start date didn't look right, so the draft starts when you publish.");
    startNow = true;
    startDate = today;
    startTime = "00:00";
  }
  const hasEnd = !!(draft.endDate && DATE.test(draft.endDate) && zonedToUtc(draft.endDate, draft.endTime && TIME.test(draft.endTime) ? draft.endTime : "23:59", timezone));

  return {
    draft: {
      name: draft.name.trim().slice(0, 60),
      badgeText,
      badgeColor: HEX.test(draft.badgeColor) ? draft.badgeColor.toUpperCase() : "#E33C2B",
      position: draft.position,
      size: Math.min(24, Math.max(8, Math.round(Number.isFinite(draft.size) ? draft.size : 12))),
      targetType,
      targetRef,
      targetLabel,
      targetCount,
      sampleTitles,
      collectionId: targetType === "collection" ? targetRef : null,
      productSearch: targetType === "products" ? (draft.productSearch ?? "").trim().slice(0, 300) : null,
      startNow,
      startDate,
      startTime,
      hasEnd,
      endDate: hasEnd ? draft.endDate! : today,
      endTime: hasEnd && draft.endTime && TIME.test(draft.endTime) ? draft.endTime : "23:59",
      warning: claimWarning("", badgeText),
    },
    notes,
  };
}

export type AssistantResult =
  | { ok: true; reply: string; draft: ResolvedDraft | null }
  | { ok: false; error: string; needsKey?: boolean };

export async function runAssistant(admin: AdminGraphqlClient, shop: string, history: ChatMessage[]): Promise<AssistantResult> {
  const settings = await db.shopSettings.findUnique({ where: { shop } });
  if (!settings || !planHasAi(settings.plan)) return { ok: false, error: "The AI assistant is part of Premium and Unlimited." };
  if (!settings.aiKeyCipher || !isProvider(settings.aiProvider) || !settings.aiModel) {
    return { ok: false, error: "Connect your AI key in Settings first.", needsKey: true };
  }
  if (rateLimited(shop)) return { ok: false, error: "That's a lot of requests this hour — try again in a little while." };

  let apiKey: string;
  try {
    apiKey = decryptSecret(settings.aiKeyCipher);
  } catch {
    return { ok: false, error: "Your saved AI key can't be read any more. Reconnect it in Settings.", needsKey: true };
  }

  const messages = history
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
  // The window can open on an assistant reply; the conversation must start with the merchant.
  while (messages[0]?.role === "assistant") messages.shift();
  if (!messages.length || messages[0]!.role !== "user") return { ok: false, error: "Type what you'd like to badge." };

  const [shopInfo, collections] = await Promise.all([fetchShopInfo(admin), listCollections(admin)]);
  const now = utcToZoned(new Date(), shopInfo.ianaTimezone);
  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;

  try {
    const turn = await askAssistant({
      provider: settings.aiProvider,
      apiKey,
      model: settings.aiModel,
      system: systemPrompt({ shopName: shopInfo.name, timezone: shopInfo.ianaTimezone, now, plan, collections }),
      messages,
    });
    if (!turn.draft) return { ok: true, reply: turn.reply, draft: null };
    const { draft, notes } = await resolveDraft(admin, turn.draft, collections, shopInfo.ianaTimezone, now.date);
    return { ok: true, reply: [turn.reply, ...notes].join(" "), draft };
  } catch (error) {
    if (error instanceof AiError) return { ok: false, error: error.message, needsKey: error.kind === "auth" };
    if (error instanceof Response) throw error;
    console.error(`[BadgeFlow] AI assistant failed for ${shop}:`, error instanceof Error ? error.name : "unknown error");
    return { ok: false, error: "Something went wrong talking to your AI provider. Try again." };
  }
}
