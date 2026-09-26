// Shared save logic for the create and edit campaign routes: validates every
// field on the server (the browser's checks are only a convenience), turns
// the schedule into UTC using the shop's timezone, saves, republishes the
// storefront, and reports what shoppers will actually see.
import { redirect } from "react-router";
import db from "../db.server";
import { POSITIONS } from "./badges";
import { computeStatus, PLANS, runningWindows, type PlanId } from "./campaign";
import { zonedToUtc } from "./timezone";
import { fetchShopInfo } from "./shopify-catalog.server";
import { publishOutcome, syncStorefront } from "./storefront-sync.server";

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

export const BADGE_TEXT_MAX = 22;
export const SIZE_MIN = 8;
export const SIZE_MAX = 24;
const NAME_MAX = 60;
const MAX_PICKED = 250;

const HEX = /^#[0-9a-f]{6}$/i;
const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;
const HANDLE = /^[a-z0-9][a-z0-9-_]*$/i;

export type CampaignErrors = Partial<Record<"badgeText" | "badgeColor" | "position" | "size" | "targetValue" | "startAt" | "endAt" | "form", string>>;

function str(formData: FormData, key: string, fallback = ""): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : fallback;
}

function sizeOf(raw: string, fallback: number): number | null {
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded < SIZE_MIN || rounded > SIZE_MAX ? null : rounded;
}

export async function saveCampaign({
  admin,
  shop,
  formData,
  editingId,
}: {
  admin: AdminGraphqlClient;
  shop: string;
  formData: FormData;
  editingId: string | null;
}) {
  const intent = str(formData, "intent") === "publish" ? "publish" : "draft";
  const errors: CampaignErrors = {};

  const campaignName = str(formData, "campaignName").slice(0, NAME_MAX);
  const badgeText = str(formData, "badgeText");
  if (!badgeText) errors.badgeText = "Badge text is required";
  else if (badgeText.length > BADGE_TEXT_MAX) errors.badgeText = `Keep badge text to ${BADGE_TEXT_MAX} characters`;

  const badgeColor = str(formData, "badgeColor", "#E33C2B");
  if (!HEX.test(badgeColor)) errors.badgeColor = "Pick a colour";

  const position = str(formData, "position", "top-left");
  const mobilePosition = str(formData, "mobilePosition", position);
  if (![position, mobilePosition].every((p) => (POSITIONS as readonly string[]).includes(p))) {
    errors.position = "Pick a position on the image";
  }

  const size = sizeOf(str(formData, "size"), 12);
  const mobileSize = sizeOf(str(formData, "mobileSize"), size ?? 12);
  if (size === null || mobileSize === null) errors.size = `Size must be between ${SIZE_MIN}% and ${SIZE_MAX}%`;

  const targetType = str(formData, "targetType", "all");
  let targetRef = str(formData, "targetRef");
  let targetValue = "All products";
  if (targetType === "all") {
    targetRef = "";
  } else if (targetType === "collection") {
    if (!COLLECTION_GID.test(targetRef)) errors.targetValue = "Choose a collection";
    targetValue = str(formData, "targetLabel").slice(0, 120) || "Collection";
  } else if (targetType === "products") {
    const picked = [...new Set(targetRef.split(",").map((e) => e.trim()).filter(Boolean))];
    if (!picked.length) errors.targetValue = "Choose at least one product";
    else if (picked.length > MAX_PICKED) errors.targetValue = `Choose up to ${MAX_PICKED} products, or use a collection`;
    else if (!picked.every((e) => PRODUCT_GID.test(e) || HANDLE.test(e))) errors.targetValue = "Choose products with the product picker";
    targetRef = picked.join(",");
    targetValue = `${picked.length} product${picked.length === 1 ? "" : "s"}`;
  } else {
    errors.targetValue = "Choose which products get the badge";
  }

  // Schedule, in the shop's timezone.
  const { ianaTimezone } = await fetchShopInfo(admin);
  const now = new Date();
  const startNow = str(formData, "startMode") !== "date";
  let startAt: Date | null = startNow ? now : zonedToUtc(str(formData, "startDate"), str(formData, "startTime", "00:00"), ianaTimezone);
  if (!startAt) {
    if (intent === "publish") errors.startAt = "Pick a valid start date and time";
    startAt = now;
  }
  let endAt: Date | null = null;
  if (str(formData, "hasEnd") === "1") {
    endAt = zonedToUtc(str(formData, "endDate"), str(formData, "endTime", "23:59"), ianaTimezone);
    if (!endAt) errors.endAt = "Pick a valid end date and time";
    else if (endAt <= startAt) errors.endAt = "End must be after the start";
    else if (intent === "publish" && endAt <= now) errors.endAt = "The end is already in the past";
  }

  if (Object.keys(errors).length > 0) return { errors };

  const isDraft = intent === "draft";
  const data = {
    badgeLabel: campaignName || `${targetValue} — ${badgeText}`,
    badgeText,
    badgeColor,
    position,
    size: size!,
    mobilePosition,
    mobileSize: mobileSize!,
    targetType,
    targetRef,
    targetValue,
    startAt,
    endAt,
    isDraft,
    status: isDraft ? "draft" : computeStatus(startAt, endAt, now),
  };

  let id = editingId;
  if (editingId) {
    const { count } = await db.campaign.updateMany({ where: { id: editingId, shop }, data });
    if (count === 0) return { errors: { form: "This campaign no longer exists." } satisfies CampaignErrors };
  } else {
    id = (await db.campaign.create({ data: { shop, ...data } })).id;
  }

  const sync = await syncStorefront(admin, shop);
  if (isDraft) return redirect(`/app/campaigns?toast=${sync.ok ? "draft-saved" : "sync-failed"}`);
  const [settings, campaigns] = await Promise.all([
    db.shopSettings.findUnique({ where: { shop } }),
    db.campaign.findMany({ where: { shop } }),
  ]);
  const plan = (settings && settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const hasSlot = runningWindows(campaigns, plan).has(id!);
  const outcome = publishOutcome(sync, { id: id!, startAt }, hasSlot);
  return redirect(`/app/campaigns/storefront?id=${id}&toast=${outcome}`);
}
