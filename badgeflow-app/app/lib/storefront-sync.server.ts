// Publishes the shop's live and upcoming campaigns to the storefront. The
// theme app embed (extensions/badgeflow-badges) reads this app-owned
// metafield via `app.metafields.badgeflow.config` — no product scopes or
// theme code needed. Scheduling is enforced in the browser, so a campaign
// starts and ends on time even if nothing is re-synced.
import db from "../db.server";
import { PLANS, runningWindows, type PlanId } from "./campaign";

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

// Keeps the metafield well under Shopify's JSON size limit. Collections are
// paged up to this many products per campaign.
const MAX_HANDLES_PER_CAMPAIGN = 1000;
const PAGE_SIZE = 250;

export type StorefrontCampaign = {
  id: string;
  text: string;
  color: string;
  position: string;
  size: number;
  mobilePosition: string | null;
  mobileSize: number | null;
  startAt: string;
  endAt: string | null;
  createdAt: string;
  all: boolean;
  handles: string[];
};

export type StorefrontConfig = {
  version: 1;
  enabled: boolean;
  rules: { hideSoldOut: boolean; oneBadgePerProduct: boolean; shrinkOnMobile: boolean };
  campaigns: StorefrontCampaign[];
  syncedAt: string;
};

export type SyncResult = { ok: boolean; config: StorefrontConfig | null };

async function json(response: Response) {
  const body = await response.json();
  if (body?.errors) throw new Error(`Admin API error: ${JSON.stringify(body.errors)}`);
  return body;
}

async function collectionHandles(admin: AdminGraphqlClient, collectionId: string, cap: number): Promise<string[]> {
  const handles: string[] = [];
  let after: string | null = null;
  while (handles.length < cap) {
    const body = await json(
      await admin.graphql(
        `#graphql
          query BadgeFlowCollectionHandles($id: ID!, $first: Int!, $after: String) {
            collection(id: $id) {
              products(first: $first, after: $after) { nodes { handle } pageInfo { hasNextPage endCursor } }
            }
          }`,
        { variables: { id: collectionId, first: Math.min(PAGE_SIZE, cap - handles.length), after } },
      ),
    );
    const products = body?.data?.collection?.products;
    if (!products) break;
    handles.push(...(products.nodes as { handle: string }[]).map((n) => n.handle.toLowerCase()));
    if (!products.pageInfo?.hasNextPage) break;
    after = products.pageInfo.endCursor;
  }
  return handles;
}

async function firstProductHandles(admin: AdminGraphqlClient, count: number): Promise<string[]> {
  const body = await json(
    await admin.graphql(
      `#graphql
        query BadgeFlowAllHandles($first: Int!) { products(first: $first, sortKey: TITLE) { nodes { handle } } }`,
      { variables: { first: Math.max(1, Math.min(PAGE_SIZE, count)) } },
    ),
  );
  return ((body?.data?.products?.nodes ?? []) as { handle: string }[]).map((n) => n.handle.toLowerCase());
}

// Hand-picked targets are product GIDs from the resource picker (older
// campaigns stored handles directly — both are accepted).
async function pickedHandles(admin: AdminGraphqlClient, targetRef: string): Promise<string[]> {
  const entries = targetRef.split(",").map((h) => h.trim()).filter(Boolean);
  const ids = entries.filter((e) => e.startsWith("gid://"));
  const handles = entries.filter((e) => !e.startsWith("gid://")).map((h) => h.toLowerCase());
  for (let i = 0; i < ids.length; i += PAGE_SIZE) {
    const body = await json(
      await admin.graphql(
        `#graphql
          query BadgeFlowPickedHandles($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { handle } } }`,
        { variables: { ids: ids.slice(i, i + PAGE_SIZE) } },
      ),
    );
    for (const node of (body?.data?.nodes ?? []) as ({ handle?: string } | null)[]) {
      if (node?.handle) handles.push(node.handle.toLowerCase());
    }
  }
  return handles;
}

export async function buildStorefrontConfig(admin: AdminGraphqlClient, shop: string): Promise<StorefrontConfig> {
  const [settings, campaigns] = await Promise.all([
    db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } }),
    db.campaign.findMany({ where: { shop, isDraft: false }, orderBy: { createdAt: "desc" } }),
  ]);

  // Plan limits are enforced here, so what the storefront shows always
  // matches the plan: extra live campaigns queue, and products past the
  // plan's product limit simply get no badge.
  const planId = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const plan = PLANS[planId];
  const windows = runningWindows(campaigns, planId);
  const running = campaigns
    .filter((c) => windows.has(c.id))
    .sort((a, b) => windows.get(a.id)!.startAt.getTime() - windows.get(b.id)!.startAt.getTime());
  const badged = new Set<string>();

  const published: StorefrontCampaign[] = [];
  for (const c of running) {
    const room = plan.limit === Infinity ? MAX_HANDLES_PER_CAMPAIGN : Math.min(MAX_HANDLES_PER_CAMPAIGN, plan.limit);
    let all = c.targetType === "all";
    let handles: string[] = [];
    if (c.targetType === "products") {
      handles = await pickedHandles(admin, c.targetRef);
    } else if (c.targetType === "collection" && c.targetRef) {
      handles = await collectionHandles(admin, c.targetRef, room);
    } else if (all && plan.limit !== Infinity) {
      handles = await firstProductHandles(admin, plan.limit);
      all = false;
    }
    if (plan.limit !== Infinity) {
      handles = handles.filter((h) => {
        if (badged.has(h)) return true;
        if (badged.size >= plan.limit) return false;
        badged.add(h);
        return true;
      });
      if (!handles.length) continue;
    }
    if (!all && !handles.length) continue;
    const w = windows.get(c.id)!;
    published.push({
      id: c.id,
      text: c.badgeText,
      color: c.badgeColor,
      position: c.position,
      size: c.size,
      mobilePosition: c.mobilePosition,
      mobileSize: c.mobileSize,
      startAt: w.startAt.toISOString(),
      endAt: w.endAt ? w.endAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      all,
      handles: handles.slice(0, MAX_HANDLES_PER_CAMPAIGN),
    });
  }

  return {
    version: 1,
    enabled: settings.appEnabled,
    rules: {
      hideSoldOut: settings.hideSoldOut,
      // Stacking is a paid feature, so a downgrade to Free turns it off even
      // if the stored setting still allows it.
      oneBadgePerProduct: planId === "free" ? true : settings.oneBadgePerProduct,
      shrinkOnMobile: settings.shrinkOnMobile,
    },
    campaigns: published,
    syncedAt: new Date().toISOString(),
  };
}

const lastSync = new Map<string, { config: StorefrontConfig; at: number }>();

// Never throws: a failed sync must not break saving a campaign or settings.
// Returns whether the storefront is up to date so callers can tell the
// merchant, plus the published config.
export async function syncStorefront(admin: AdminGraphqlClient, shop: string): Promise<SyncResult> {
  try {
    const config = await buildStorefrontConfig(admin, shop);

    const installation = await json(
      await admin.graphql(`#graphql
        query BadgeFlowInstallation { currentAppInstallation { id } }`),
    );
    const ownerId: string | undefined = installation?.data?.currentAppInstallation?.id;
    if (!ownerId) throw new Error("No app installation id");

    const body = await json(
      await admin.graphql(
        `#graphql
          mutation BadgeFlowSyncStorefront($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              userErrors { field message }
            }
          }`,
        {
          variables: {
            metafields: [{ ownerId, namespace: "badgeflow", key: "config", type: "json", value: JSON.stringify(config) }],
          },
        },
      ),
    );
    const errors = body?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
    lastSync.set(shop, { config, at: Date.now() });
    return { ok: true, config };
  } catch (error) {
    console.error(`[BadgeFlow] storefront sync failed for ${shop}:`, error);
    return { ok: false, config: null };
  }
}

// Collection membership changes outside the app, so pages that show what
// shoppers see re-sync — but at most every few minutes, not on every view.
export async function syncStorefrontIfStale(
  admin: AdminGraphqlClient,
  shop: string,
  maxAgeMs = 10 * 60 * 1000,
): Promise<SyncResult> {
  const last = lastSync.get(shop);
  if (last && Date.now() - last.at < maxAgeMs) return { ok: true, config: last.config };
  return syncStorefront(admin, shop);
}

export function forgetStorefrontSync(shop: string) {
  lastSync.delete(shop);
}

// Products carrying a badge right now, as the storefront enforces it.
export function badgedProductCount(config: StorefrontConfig | null, totalProducts: number, now = new Date()): number {
  if (!config) return 0;
  const active = config.campaigns.filter(
    (c) => Date.parse(c.startAt) <= now.getTime() && (!c.endAt || Date.parse(c.endAt) > now.getTime()),
  );
  if (active.some((c) => c.all)) return totalProducts;
  return new Set(active.flatMap((c) => c.handles)).size;
}

export type PublishOutcome = "published" | "scheduled" | "queued" | "not-showing" | "sync-failed";

// What a just-saved campaign will actually do on the storefront.
export function publishOutcome(
  result: SyncResult,
  campaign: { id: string; startAt: Date },
  now = new Date(),
): PublishOutcome {
  if (!result.ok || !result.config) return "sync-failed";
  const entry = result.config.campaigns.find((c) => c.id === campaign.id);
  if (!entry) return "not-showing";
  const start = Date.parse(entry.startAt);
  if (start <= now.getTime()) return "published";
  return start > campaign.startAt.getTime() ? "queued" : "scheduled";
}

export const EMBED_HANDLE = "badgeflow-embed";

// Deep link that opens the live theme's editor with the BadgeFlow embed
// switched on, ready for the merchant to save.
export function themeEditorEmbedLink(apiKey: string): string {
  return `shopify:admin/themes/current/editor?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`;
}
