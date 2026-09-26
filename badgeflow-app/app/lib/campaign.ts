export type CampaignStatus = "draft" | "scheduled" | "live" | "ended";

// States move on their own based on the clock, not a stored flag — except
// "draft", which is an explicit merchant choice (isDraft) and overrides the
// date math entirely until they schedule it via Review.
export function computeStatus(startAt: Date, endAt: Date | null, now: Date = new Date()): "scheduled" | "live" | "ended" {
  if (now < startAt) return "scheduled";
  if (endAt && now > endAt) return "ended";
  return "live";
}

export function displayStatus(
  campaign: { isDraft: boolean; startAt: Date; endAt: Date | null },
  now: Date = new Date(),
): CampaignStatus {
  if (campaign.isDraft) return "draft";
  return computeStatus(campaign.startAt, campaign.endAt, now);
}

export function statusTone(status: CampaignStatus | "queued"): "info" | "success" | "neutral" | "warning" {
  if (status === "live") return "success";
  if (status === "scheduled") return "info";
  if (status === "queued") return "warning";
  return "neutral";
}

export function statusLabel(status: CampaignStatus | "queued"): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

export type PlanId = "free" | "premium" | "unlimited";

type Window = { startAt: Date; endAt: Date | null };
type Schedulable = { id: string; isDraft: boolean; startAt: Date; endAt: Date | null };

// When each published campaign really runs on the storefront. Free allows
// one live campaign at a time: campaigns queue in start order, each waiting
// for the previous one to end. A campaign queued behind one with no end date
// never runs, so it gets no window.
export function runningWindows(campaigns: Schedulable[], planId: PlanId, now: Date = new Date()): Map<string, Window> {
  const out = new Map<string, Window>();
  const upcoming = campaigns
    .filter((c) => !c.isDraft && computeStatus(c.startAt, c.endAt, now) !== "ended")
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (PLANS[planId].liveCampaignLimit === Infinity) {
    upcoming.forEach((c) => out.set(c.id, { startAt: c.startAt, endAt: c.endAt }));
    return out;
  }
  let freeFrom: Date | null = new Date(0); // when the single slot frees up; null = never
  for (const c of upcoming) {
    if (freeFrom === null) continue;
    const start = c.startAt > freeFrom ? c.startAt : freeFrom;
    if (c.endAt && c.endAt <= start) continue; // its whole window passed while queued
    out.set(c.id, { startAt: start, endAt: c.endAt });
    freeFrom = c.endAt;
  }
  return out;
}

// Status as shoppers experience it: a campaign that is live by its dates but
// waiting behind another one on Free is "queued", not "live".
export function storefrontStatus(
  campaign: Schedulable,
  windows: Map<string, Window>,
  now: Date = new Date(),
): CampaignStatus | "queued" {
  const status = displayStatus(campaign, now);
  if (status !== "live" && status !== "scheduled") return status;
  const w = windows.get(campaign.id);
  if (!w) return "queued";
  if (w.startAt > now) return w.startAt > campaign.startAt ? "queued" : "scheduled";
  return "live";
}

// On Free, the campaign whose slot a queued campaign is waiting for: the one
// that ends right when it starts, or — if it can never start — the running
// campaign with no end date.
export function blockingCampaign<T extends Schedulable>(
  campaign: Schedulable,
  campaigns: T[],
  windows: Map<string, Window>,
): T | null {
  const own = windows.get(campaign.id);
  const others = campaigns.filter((c) => c.id !== campaign.id && windows.has(c.id));
  if (own) {
    if (own.startAt <= campaign.startAt) return null;
    return others.find((c) => windows.get(c.id)!.endAt?.getTime() === own.startAt.getTime()) ?? null;
  }
  return others.find((c) => windows.get(c.id)!.endAt === null) ?? null;
}

// "All products", "12 products", or the collection's stored count suffix
// ("Autumn Essentials — 42 products" → "42 products").
export function productsLabel(c: { targetType: string; targetRef: string; targetValue: string }): string {
  if (c.targetType === "all") return "All products";
  if (c.targetType === "products") {
    const n = c.targetRef.split(",").map((h) => h.trim()).filter(Boolean).length;
    return `${n} product${n === 1 ? "" : "s"}`;
  }
  const idx = c.targetValue.lastIndexOf(" — ");
  return idx === -1 ? c.targetValue : c.targetValue.slice(idx + 3);
}

export const PLANS: Record<PlanId, { label: string; limit: number; price: string; period: string; liveCampaignLimit: number }> = {
  free: { label: "Free", limit: 30, price: "$0", period: "for life", liveCampaignLimit: 1 },
  premium: { label: "Premium", limit: 150, price: "$4.99", period: "/month", liveCampaignLimit: Infinity },
  unlimited: { label: "Unlimited", limit: Infinity, price: "$9.99", period: "/month", liveCampaignLimit: Infinity },
};

// Brand accent — distinct from semantic status colors (success/warning/critical)
// so selection states and progress indicators never get confused with them.
export const BRAND = "#E25C07";
export const BRAND_SOFT = "#FCEBDD";

export type SetupStep = { key: string; label: string; done: boolean; href: string; description: string };

export function setupSteps(opts: { embedConfirmed: boolean; hasCampaign: boolean }): SetupStep[] {
  return [
    {
      key: "embed",
      label: "Enable BadgeFlow in your theme",
      description: "Turns on the storefront embed so badges can render on product images.",
      done: opts.embedConfirmed,
      href: "/app/setup",
    },
    {
      key: "campaign",
      label: "Create your first campaign",
      description: "Pick a badge, target some products, and set a schedule.",
      done: opts.hasCampaign,
      href: "/app/campaigns/new",
    },
    {
      key: "storefront",
      label: "Check your storefront",
      description: "Open your storefront to see a badge on a real product card.",
      // BadgeFlow can't look at the storefront itself, so this counts as done
      // once badges can render there: embed on + a campaign.
      done: opts.hasCampaign && opts.embedConfirmed,
      href: "/app/setup",
    },
  ];
}
