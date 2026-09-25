// Publishes the shop's live and upcoming campaigns to the storefront. The
// theme app embed (extensions/badgeflow-badges) reads this app-owned
// metafield via `app.metafields.badgeflow.config` — no product scopes or
// theme code needed. Scheduling is enforced in the browser, so a campaign
// starts and ends on time even if nothing is re-synced.
import db from "../db.server";
import { displayStatus, PLANS, type PlanId } from "./campaign";

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

// Keeps the metafield well under Shopify's JSON size limit.
const MAX_HANDLES_PER_CAMPAIGN = 250;

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

async function collectionHandles(admin: AdminGraphqlClient, collectionId: string): Promise<string[]> {
  const response = await admin.graphql(
    `#graphql
      query BadgeFlowCollectionHandles($id: ID!, $first: Int!) {
        collection(id: $id) { products(first: $first) { nodes { handle } } }
      }`,
    { variables: { id: collectionId, first: MAX_HANDLES_PER_CAMPAIGN } },
  );
  const json = await response.json();
  const nodes: { handle: string }[] = json?.data?.collection?.products?.nodes ?? [];
  return nodes.map((n) => n.handle.toLowerCase());
}

async function allProductHandles(admin: AdminGraphqlClient): Promise<string[]> {
  const response = await admin.graphql(
    `#graphql
      query BadgeFlowAllHandles($first: Int!) { products(first: $first, sortKey: TITLE) { nodes { handle } } }`,
    { variables: { first: MAX_HANDLES_PER_CAMPAIGN } },
  );
  const nodes: { handle: string }[] = (await response.json())?.data?.products?.nodes ?? [];
  return nodes.map((n) => n.handle.toLowerCase());
}

type Window = { startAt: Date; endAt: Date | null };

// Free allows one live campaign at a time: campaigns queue in start order,
// each waiting for the previous one to end. A queued campaign behind one
// with no end date never shows. Returns the window each campaign really runs.
function queueWindows<T extends Window>(items: T[], liveLimit: number): Map<T, Window> {
  const out = new Map<T, Window>();
  const sorted = [...items].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (liveLimit === Infinity) {
    sorted.forEach((c) => out.set(c, { startAt: c.startAt, endAt: c.endAt }));
    return out;
  }
  let freeFrom: Date | null = new Date(0); // when the single slot frees up; null = never
  for (const c of sorted) {
    if (freeFrom === null) continue;
    const start = c.startAt > freeFrom ? c.startAt : freeFrom;
    if (c.endAt && c.endAt <= start) continue; // its whole window passed while queued
    out.set(c, { startAt: start, endAt: c.endAt });
    freeFrom = c.endAt;
  }
  return out;
}

export async function buildStorefrontConfig(admin: AdminGraphqlClient, shop: string) {
  const [settings, campaigns] = await Promise.all([
    db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } }),
    db.campaign.findMany({ where: { shop, isDraft: false }, orderBy: { createdAt: "desc" } }),
  ]);

  const upcoming = campaigns.filter((c) => {
    const status = displayStatus(c);
    return status === "live" || status === "scheduled";
  });

  // Plan limits are enforced here, so what the storefront shows always
  // matches the plan: extra live campaigns queue, and products past the
  // plan's product limit simply get no badge.
  const planId = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const plan = PLANS[planId];
  const windows = queueWindows(upcoming, plan.liveCampaignLimit);
  const running = [...windows.keys()].sort((a, b) => windows.get(a)!.startAt.getTime() - windows.get(b)!.startAt.getTime());
  const badged = new Set<string>();
  let everyHandle: string[] | null = null;

  const published: StorefrontCampaign[] = [];
  for (const c of running) {
    let all = c.targetType === "all";
    let handles: string[] = [];
    if (c.targetType === "products") {
      handles = c.targetRef.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    } else if (c.targetType === "collection" && c.targetRef) {
      handles = await collectionHandles(admin, c.targetRef);
    } else if (all && plan.limit !== Infinity) {
      everyHandle ??= await allProductHandles(admin);
      handles = everyHandle;
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
    const w = windows.get(c)!;
    published.push(
      {
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
      },
    );
  }

  return {
    version: 1,
    enabled: settings.appEnabled,
    rules: {
      hideSoldOut: settings.hideSoldOut,
      oneBadgePerProduct: settings.oneBadgePerProduct,
      shrinkOnMobile: settings.shrinkOnMobile,
    },
    campaigns: published,
    syncedAt: new Date().toISOString(),
  };
}

// Never throws: a failed sync must not break saving a campaign or settings.
// Returns whether the storefront is up to date so callers can warn if not.
export async function syncStorefront(admin: AdminGraphqlClient, shop: string): Promise<boolean> {
  try {
    const config = await buildStorefrontConfig(admin, shop);

    const installation = await admin.graphql(`#graphql
      query BadgeFlowInstallation { currentAppInstallation { id } }`);
    const ownerId: string | undefined = (await installation.json())?.data?.currentAppInstallation?.id;
    if (!ownerId) throw new Error("No app installation id");

    const response = await admin.graphql(
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
    );
    const errors = (await response.json())?.data?.metafieldsSet?.userErrors ?? [];
    if (errors.length) throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
    return true;
  } catch (error) {
    console.error(`[BadgeFlow] storefront sync failed for ${shop}:`, error);
    return false;
  }
}

export const EMBED_HANDLE = "badgeflow-embed";

// Deep link that opens the live theme's editor with the BadgeFlow embed
// switched on, ready for the merchant to save.
export function themeEditorEmbedLink(apiKey: string): string {
  return `shopify:admin/themes/current/editor?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`;
}
