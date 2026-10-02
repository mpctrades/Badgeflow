// Keeps every shop's storefront copy fresh without the merchant opening the
// app. Collection membership, new products, renamed handles and plan changes
// all happen outside BadgeFlow, and the wizard promises that products added
// later get the badge within a few minutes.
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { refreshPlan } from "./billing.server";
import { syncStorefront } from "./storefront-sync.server";

const INTERVAL_MS = 5 * 60 * 1000;
let running = false;

async function resyncAll() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    // Only shops with something live or upcoming need a fresh copy.
    const shops = await db.campaign.findMany({
      where: { isDraft: false, OR: [{ endAt: null }, { endAt: { gt: now } }] },
      select: { shop: true },
      distinct: ["shop"],
    });
    for (const { shop } of shops) {
      // No offline session means the app is uninstalled; skip until reinstall.
      if (!(await db.session.count({ where: { shop, isOnline: false } }))) continue;
      try {
        const { admin } = await unauthenticated.admin(shop);
        await refreshPlan(admin, shop);
        await syncStorefront(admin, shop);
      } catch (error) {
        console.error(`[BadgeFlow] background sync failed for ${shop}:`, error instanceof Response ? error.status : error);
      }
    }
  } finally {
    running = false;
  }
}

export function startBackgroundSync() {
  const g = globalThis as { __badgeflowSync?: ReturnType<typeof setInterval> };
  if (g.__badgeflowSync) return;
  g.__badgeflowSync = setInterval(() => {
    resyncAll().catch((error) => console.error("[BadgeFlow] background sync failed:", error));
  }, INTERVAL_MS);
  g.__badgeflowSync.unref?.();
}
