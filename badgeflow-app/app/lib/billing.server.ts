// Shopify App Pricing integration. Plans, prices and trials are configured in
// the Partner Dashboard (Distribution → Manage listing → Pricing); merchants
// pick a plan on Shopify's hosted plan selection page, and this module reads
// the result from the Partner API's activeSubscription query. The app never
// creates charges itself.
//
// Required env (server .env):
//   SHOPIFY_PARTNER_ORG_ID            e.g. 4782498 (from the Partner Dashboard URL)
//   SHOPIFY_PARTNER_API_ACCESS_TOKEN  Partner API client token with "Manage apps"
//   SHOPIFY_APP_GID                   gid://shopify/App/<numeric id from the app's Partner Dashboard URL>
//   SHOPIFY_APP_HANDLE                app handle used in the plan selection URL (default "badgeflow-app")
import db from "../db.server";
import type { PlanId } from "./campaign";

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

const PARTNER_API_VERSION = "2026-07";
// Only confirmed results are cached, so a merchant who just approved a plan is
// checked again right away via `force`, and cancellations show up within minutes.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { status: PlanStatus; at: number }>();

export type PlanStatus = {
  plan: PlanId;
  // "shopify": read live from Shopify App Pricing. "stored": billing isn't
  // configured or the Partner API failed, so the last known plan is used.
  source: "shopify" | "stored";
  billingPeriod: string | null;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  pendingPlan: PlanId | null;
  error: string | null;
};

export function billingConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_PARTNER_ORG_ID && process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN && process.env.SHOPIFY_APP_GID,
  );
}

// Shopify's hosted plan selection page for this app. Must be opened with
// target "_top" because it lives outside the app iframe.
export function planSelectionUrl(shop: string): string {
  const storeHandle = shop.replace(".myshopify.com", "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "badgeflow-app";
  return `https://admin.shopify.com/store/${storeHandle}/charges/${appHandle}/pricing_plans`;
}

// Plan handles are set in the Partner Dashboard plan editor. Anything that
// isn't recognisably Premium or Unlimited is treated as Free.
function planFromHandle(handle: string | null | undefined): PlanId {
  const h = (handle ?? "").toLowerCase();
  // Shopify adds a private $0 "shopify-test" plan for its own testing; give it
  // every feature so app reviewers can try the paid capabilities.
  if (h === "shopify-test") return "unlimited";
  if (h.includes("unlimited")) return "unlimited";
  if (h.includes("premium")) return "premium";
  return "free";
}

type ActiveSubscription = {
  billingPeriod: string | null;
  cancelAtEndOfCycle: boolean;
  trialEndsAt: string | null;
  items: { handle: string }[];
  pendingUpdate: { items: { handle: string }[] } | null;
} | null;

async function fetchActiveSubscription(shopId: string): Promise<ActiveSubscription> {
  const res = await fetch(
    `https://partners.shopify.com/${process.env.SHOPIFY_PARTNER_ORG_ID}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN || "",
      },
      body: JSON.stringify({
        query: `query BadgeFlowActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            billingPeriod
            cancelAtEndOfCycle
            trialEndsAt
            items { handle }
            pendingUpdate { items { handle } }
          }
        }`,
        variables: { appId: process.env.SHOPIFY_APP_GID, shopId },
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  // Throw on throttling or failures so a paying merchant is never downgraded
  // because the Partner API hiccupped.
  if (!res.ok || body.errors) {
    throw new Error(`Partner API request failed: ${JSON.stringify(body.errors ?? res.status)}`);
  }
  // null means the shop has no Shopify App Pricing contract (never chose a
  // plan, declined the charge, or uninstalled — Shopify cancels on uninstall).
  return body.data?.activeSubscription ?? null;
}

// Returns the merchant's current plan and keeps ShopSettings.plan in sync so
// the rest of the app (limits, gating) can keep reading it from the database.
export async function refreshPlan(
  admin: AdminGraphqlClient,
  shop: string,
  opts: { force?: boolean } = {},
): Promise<PlanStatus> {
  const cached = cache.get(shop);
  if (!opts.force && cached && Date.now() - cached.at < CACHE_MS) return cached.status;

  const settings = await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });
  const stored: PlanStatus = {
    plan: (settings.plan as PlanId) ?? "free",
    source: "stored",
    billingPeriod: null,
    cancelAtEndOfCycle: false,
    trialEndsAt: null,
    pendingPlan: null,
    error: null,
  };
  if (!billingConfigured()) return { ...stored, error: "Shopify App Pricing isn't connected on this server yet." };

  try {
    const shopResponse = await admin.graphql(`#graphql
      query BadgeFlowShopId { shop { id } }`);
    const shopId: string | undefined = (await shopResponse.json())?.data?.shop?.id;
    if (!shopId) throw new Error("Couldn't read the shop id");

    const sub = await fetchActiveSubscription(shopId);
    const status: PlanStatus = {
      plan: sub ? planFromHandle(sub.items?.[0]?.handle) : "free",
      source: "shopify",
      billingPeriod: sub?.billingPeriod ?? null,
      cancelAtEndOfCycle: sub?.cancelAtEndOfCycle ?? false,
      trialEndsAt: sub?.trialEndsAt ?? null,
      pendingPlan: sub?.pendingUpdate?.items?.[0] ? planFromHandle(sub.pendingUpdate.items[0].handle) : null,
      error: null,
    };
    if (status.plan !== settings.plan) {
      await db.shopSettings.update({ where: { shop }, data: { plan: status.plan } });
    }
    cache.set(shop, { status, at: Date.now() });
    return status;
  } catch (error) {
    console.error(`[BadgeFlow] plan check failed for ${shop}:`, error);
    return { ...stored, error: "Couldn't reach Shopify billing just now — showing your last known plan." };
  }
}

// Same page as planSelectionUrl, as an App Bridge admin link for buttons
// inside the embedded app (a plain https link can't leave the iframe).
export function pricingAdminLink(): string {
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "badgeflow-app";
  return `shopify:admin/charges/${appHandle}/pricing_plans`;
}

export function forgetPlan(shop: string) {
  cache.delete(shop);
}
