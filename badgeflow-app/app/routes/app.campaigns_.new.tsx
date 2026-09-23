import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { computeStatus, type PlanId } from "../lib/campaign";
import { BADGE_PRESETS } from "../lib/badges";
import { fetchCollections, fetchPreviewProducts, fetchShopInfo, fetchTotalProductCount } from "../lib/shopify-catalog.server";
import { CampaignWizard, type WizardInitial } from "../components/campaign-wizard";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  const [collections, totalProducts, settings, previewProducts, shopInfo] = await Promise.all([
    fetchCollections(admin),
    fetchTotalProductCount(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchPreviewProducts(admin, 4),
    fetchShopInfo(admin),
  ]);

  // AI assistant / other entry points can hand off straight to a prefilled step.
  const fromAi = url.searchParams.get("step") === "review";
  const initial: WizardInitial = {
    badgeId: url.searchParams.get("badgeId") ?? BADGE_PRESETS[0]!.id,
    badgeText: url.searchParams.get("badgeText") ?? BADGE_PRESETS[0]!.label,
    badgeColor: url.searchParams.get("badgeColor") ?? BADGE_PRESETS[0]!.color,
    position: "top-left",
    size: Number(url.searchParams.get("size") ?? 12),
    mobilePosition: "top-left",
    mobileSize: Number(url.searchParams.get("size") ?? 12),
    targetType: url.searchParams.get("targetType") ?? "all",
    targetRef: url.searchParams.get("targetRef") ?? "",
    startNow: true,
    startAt: "",
    hasEndDate: false,
    endAt: "",
    startStep: fromAi ? "review" : "design",
  };

  return {
    collections, totalProducts, plan: settings.plan as PlanId,
    previewProduct: previewProducts[0] ?? null,
    sampleThumbs: previewProducts,
    embedConfirmed: !!settings.embedConfirmedAt,
    timezone: shopInfo.ianaTimezone,
    initial,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "draft");

  const campaignName = String(formData.get("campaignName") ?? "").trim();
  const badgeId = String(formData.get("badgeId") ?? "");
  const badgeText = String(formData.get("badgeText") ?? "").trim();
  const badgeColor = String(formData.get("badgeColor") ?? "#E33C2B");
  const position = String(formData.get("position") ?? "top-left");
  const size = Number(formData.get("size") ?? 12);
  const mobilePosition = String(formData.get("mobilePosition") ?? position);
  const mobileSize = Number(formData.get("mobileSize") ?? size);
  const targetType = String(formData.get("targetType") ?? "all");
  const targetRef = String(formData.get("targetRef") ?? "");
  const targetLabel = String(formData.get("targetLabel") ?? "All products");
  const startAt = String(formData.get("startAt") ?? "");
  const endAt = String(formData.get("endAt") ?? "");

  const errors: Record<string, string> = {};
  if (!badgeText) errors.badgeText = "Badge text is required";
  if (targetType !== "all" && !targetRef) errors.targetValue = "Choose a target";
  if (intent === "publish" && !startAt) errors.startAt = "Start date is required";
  if (endAt && startAt && new Date(endAt) <= new Date(startAt)) errors.endAt = "End must be after start";

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const isDraft = intent === "draft";
  const targetDescription = targetType === "all" ? "All products" : targetLabel;
  const campaign = await db.campaign.create({
    data: {
      shop: session.shop,
      badgeLabel: campaignName || `${targetDescription} — ${badgeText}`,
      badgeText,
      badgeColor,
      position,
      size,
      mobilePosition,
      mobileSize,
      targetType,
      targetRef,
      targetValue: targetType === "all" ? "All products" : targetLabel,
      startAt: startAt ? new Date(startAt) : new Date(),
      endAt: endAt ? new Date(endAt) : null,
      isDraft,
      status: isDraft ? "draft" : computeStatus(startAt ? new Date(startAt) : new Date(), endAt ? new Date(endAt) : null),
    },
  });

  if (isDraft) return redirect("/app/campaigns?toast=draft-saved");
  const isImmediate = computeStatus(campaign.startAt, campaign.endAt) === "live";
  return redirect(`/app/campaigns/storefront?id=${campaign.id}&toast=${isImmediate ? "published" : "scheduled"}`);
};

export default function NewCampaignRoute() {
  const { collections, totalProducts, plan, previewProduct, sampleThumbs, embedConfirmed, timezone, initial } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CampaignWizard
      initial={initial}
      collections={collections}
      totalProducts={totalProducts}
      plan={plan}
      previewProduct={previewProduct}
      sampleThumbs={sampleThumbs}
      embedConfirmed={embedConfirmed}
      timezone={timezone}
      errors={actionData?.errors ?? {}}
    />
  );
}
