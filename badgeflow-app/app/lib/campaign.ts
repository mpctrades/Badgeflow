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

export function statusTone(status: CampaignStatus): "info" | "success" | "neutral" {
  if (status === "live") return "success";
  if (status === "scheduled") return "info";
  return "neutral";
}

export function statusLabel(status: CampaignStatus): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

// Compact merchant-facing date range, e.g. "Sep 23–26, 2026" (same month),
// "Sep 28 – Oct 2, 2026" (crosses months), or "Dec 30, 2026 – Jan 2, 2027"
// (crosses years). Falls back to a single date when there's no end.
export function formatDateRange(start: Date, end: Date | null): string {
  const startDate = new Date(start);
  if (!end) {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(startDate);
  }
  const endDate = new Date(end);
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();

  if (sameMonth) {
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(startDate);
    return `${month} ${startDate.getDate()}–${endDate.getDate()}, ${endDate.getFullYear()}`;
  }

  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(startDate);
  const endLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(endDate);
  return `${startLabel} – ${endLabel}`;
}

export type PlanId = "free" | "premium" | "unlimited";

export const PLANS: Record<PlanId, { label: string; limit: number; price: string; period: string; liveCampaignLimit: number }> = {
  free: { label: "Free", limit: 30, price: "$0", period: "for life", liveCampaignLimit: 1 },
  premium: { label: "Premium", limit: 150, price: "$4.99", period: "/month", liveCampaignLimit: Infinity },
  unlimited: { label: "Unlimited", limit: Infinity, price: "$9.99", period: "/month", liveCampaignLimit: Infinity },
};

// Brand accent — distinct from semantic status colors (success/warning/critical)
// so selection states and progress indicators never get confused with them.
export const BRAND = "#5B4FE0";
export const BRAND_SOFT = "#EFEDFB";

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
      description: "Open the storefront preview to see a badge on a real product card.",
      // Only true once badges can actually render: embed on + a campaign.
      done: opts.hasCampaign && opts.embedConfirmed,
      href: "/app/campaigns",
    },
  ];
}
