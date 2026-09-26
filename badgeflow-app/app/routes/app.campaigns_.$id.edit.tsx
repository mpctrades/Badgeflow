import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { PlanId } from "../lib/campaign";
import {
  fetchCollection,
  fetchPickedProducts,
  fetchPreviewProducts,
  fetchShopInfo,
  fetchTotalProductCount,
} from "../lib/shopify-catalog.server";
import { CampaignWizard, type WizardInitial } from "../components/campaign-wizard";
import { saveCampaign } from "../lib/campaign-form.server";
import { utcToZoned } from "../lib/timezone";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const isDuplicate = url.searchParams.get("duplicate") === "1";

  const campaign = await db.campaign.findFirst({ where: { id: params.id, shop: session.shop } });
  if (!campaign) throw redirect("/app/campaigns");

  const [totalProducts, settings, previewProducts, shopInfo, collection, pickedProducts] = await Promise.all([
    fetchTotalProductCount(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchPreviewProducts(admin, 4),
    fetchShopInfo(admin),
    campaign.targetType === "collection" ? fetchCollection(admin, campaign.targetRef) : Promise.resolve(null),
    campaign.targetType === "products" ? fetchPickedProducts(admin, campaign.targetRef) : Promise.resolve([]),
  ]);

  const tz = shopInfo.ianaTimezone;
  const start = utcToZoned(campaign.startAt, tz);
  const end = campaign.endAt ? utcToZoned(campaign.endAt, tz) : null;
  const today = utcToZoned(new Date(), tz);

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
    // Fresh label from Shopify, so a renamed or resized collection shows correctly.
    targetLabel: collection ? `${collection.title} — ${collection.productsCount} products` : campaign.targetValue,
    targetCount: collection?.productsCount,
    pickedProducts: pickedProducts.map((p) => ({ id: p.id, title: p.title })),
    // A duplicate starts as a fresh copy: same design and products, new schedule.
    startNow: isDuplicate,
    startDate: isDuplicate ? today.date : start.date,
    startTime: isDuplicate ? "00:00" : start.time,
    hasEndDate: !isDuplicate && !!end,
    endDate: end && !isDuplicate ? end.date : today.date,
    endTime: end && !isDuplicate ? end.time : "23:59",
  };

  return {
    totalProducts,
    plan: settings.plan as PlanId,
    previewProduct: previewProducts[0] ?? null,
    embedConfirmed: !!settings.embedConfirmedAt,
    timezone: tz,
    initial,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const isDuplicate = new URL(request.url).searchParams.get("duplicate") === "1";
  return saveCampaign({
    admin,
    shop: session.shop,
    formData: await request.formData(),
    editingId: isDuplicate ? null : (params.id ?? null),
  });
};

export default function EditCampaignRoute() {
  const { totalProducts, plan, previewProduct, embedConfirmed, timezone, initial } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CampaignWizard
      initial={initial}
      totalProducts={totalProducts}
      plan={plan}
      previewProduct={previewProduct}
      embedConfirmed={embedConfirmed}
      timezone={timezone}
      errors={actionData?.errors ?? {}}
    />
  );
}
