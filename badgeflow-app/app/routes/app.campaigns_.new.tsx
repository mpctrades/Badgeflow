import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { PlanId } from "../lib/campaign";
import { BADGE_PRESETS } from "../lib/badges";
import { fetchPreviewProducts, fetchShopInfo, fetchTotalProductCount } from "../lib/shopify-catalog.server";
import { CampaignWizard, type WizardInitial } from "../components/campaign-wizard";
import { saveCampaign } from "../lib/campaign-form.server";
import { utcToZoned } from "../lib/timezone";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [totalProducts, settings, previewProducts, shopInfo] = await Promise.all([
    fetchTotalProductCount(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchPreviewProducts(admin, 4),
    fetchShopInfo(admin),
  ]);

  // New campaigns start from the store-wide defaults in Settings.
  const preset = BADGE_PRESETS.find((b) => b.color.toLowerCase() === settings.defaultColor.toLowerCase()) ?? BADGE_PRESETS[0]!;
  const today = utcToZoned(new Date(), shopInfo.ianaTimezone);
  const initial: WizardInitial = {
    badgeId: preset.id,
    badgeText: preset.label,
    badgeColor: settings.defaultColor,
    position: settings.defaultPosition,
    size: settings.defaultSize,
    mobilePosition: settings.defaultPosition,
    mobileSize: settings.defaultSize,
    targetType: "all",
    targetRef: "",
    targetLabel: "All products",
    pickedProducts: [],
    startNow: true,
    startDate: today.date,
    startTime: "00:00",
    hasEndDate: false,
    endDate: today.date,
    endTime: "23:59",
  };

  return {
    totalProducts,
    plan: settings.plan as PlanId,
    previewProduct: previewProducts[0] ?? null,
    embedConfirmed: !!settings.embedConfirmedAt,
    timezone: shopInfo.ianaTimezone,
    initial,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return saveCampaign({ admin, shop: session.shop, formData: await request.formData(), editingId: null });
};

export default function NewCampaignRoute() {
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
