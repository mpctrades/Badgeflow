import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { computeStatus, type PlanId } from "../lib/campaign";
import { fetchCollections, fetchPreviewProducts, fetchShopInfo, fetchTotalProductCount } from "../lib/shopify-catalog.server";
import { CampaignWizard, type WizardInitial } from "../components/campaign-wizard";
import { syncStorefront } from "../lib/storefront-sync.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const isDuplicate = url.searchParams.get("duplicate") === "1";

  const campaign = await db.campaign.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!campaign) throw redirect("/app/campaigns");

  const [collections, totalProducts, settings, previewProducts, shopInfo] = await Promise.all([
    fetchCollections(admin),
    fetchTotalProductCount(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchPreviewProducts(admin, 4),
    fetchShopInfo(admin),
  ]);

  function toLocalInput(d: Date) {
    const copy = new Date(d);
    copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
    return copy.toISOString().slice(0, 16);
  }

  const initial: WizardInitial = {
    editingId: isDuplicate ? undefined : campaign.id,
    name: isDuplicate ? "" : campaign.badgeLabel,
    badgeId: "custom",
    badgeText: campaign.badgeText,
    badgeColor: campaign.badgeColor,
    position: campaign.position,
    size: campaign.size,
    mobilePosition: campaign.mobilePosition || campaign.position,
    mobileSize: campaign.mobileSize || campaign.size,
    targetType: campaign.targetType,
    targetRef: campaign.targetRef,
    startNow: false,
    startAt: isDuplicate ? "" : toLocalInput(campaign.startAt),
    hasEndDate: !isDuplicate && !!campaign.endAt,
    endAt: campaign.endAt && !isDuplicate ? toLocalInput(campaign.endAt) : "",
  };

  return {
    collections, totalProducts, plan: settings.plan as PlanId,
    previewProduct: previewProducts[0] ?? null,
    sampleThumbs: previewProducts,
    embedConfirmed: !!settings.embedConfirmedAt,
    timezone: shopInfo.ianaTimezone,
    initial,
    isDuplicate,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "draft");
  const isDuplicate = new URL(request.url).searchParams.get("duplicate") === "1";

  const campaignName = String(formData.get("campaignName") ?? "").trim();
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
  if (Object.keys(errors).length > 0) return { errors };

  const isDraft = intent === "draft";
  const targetDescription = targetType === "all" ? "All products" : targetLabel;
  const data = {
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
  };

  const isImmediate = computeStatus(data.startAt, data.endAt) === "live";
  const publishToast = isImmediate ? "published" : "scheduled";

  if (isDuplicate) {
    const created = await db.campaign.create({ data: { shop: session.shop, ...data } });
    await syncStorefront(admin, session.shop);
    if (isDraft) return redirect("/app/campaigns?toast=draft-saved");
    return redirect(`/app/campaigns/storefront?id=${created.id}&toast=${publishToast}`);
  }

  await db.campaign.updateMany({ where: { id: params.id, shop: session.shop }, data });
  await syncStorefront(admin, session.shop);
  if (isDraft) return redirect("/app/campaigns?toast=draft-saved");
  return redirect(`/app/campaigns/storefront?id=${params.id}&toast=${publishToast}`);
};

export default function EditCampaignRoute() {
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
