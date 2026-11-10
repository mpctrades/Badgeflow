import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { PlanId } from "../lib/campaign";
import { BADGE_PRESETS } from "../lib/badges";
import { NEW_DAYS_DEFAULT, SALE_TEMPLATES } from "../lib/smart-badges";
import { fetchCatalogStats, fetchPreviewProducts, fetchShopInfo, fetchTotalProductCount } from "../lib/shopify-catalog.server";
import { CampaignWizard, type WizardInitial } from "../components/campaign-wizard";
import { saveCampaign } from "../lib/campaign-form.server";
import { utcToZoned } from "../lib/timezone";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [totalProducts, settings, previewProducts, shopInfo, catalogStats] = await Promise.all([
    fetchTotalProductCount(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchPreviewProducts(admin, 4),
    fetchShopInfo(admin),
    fetchCatalogStats(admin),
  ]);

  // New campaigns start from the store-wide defaults in Settings, as an
  // automatic sale badge when the store has products on sale (the honest
  // default: it never shows a discount that isn't real), else fixed text.
  const preset = BADGE_PRESETS.find((b) => b.color.toLowerCase() === settings.defaultColor.toLowerCase()) ?? BADGE_PRESETS[0]!;
  const today = utcToZoned(new Date(), shopInfo.ianaTimezone);
  const startAsSale = catalogStats.onSale > 0;
  const initial: WizardInitial = {
    badgeId: preset.id,
    badgeText: startAsSale ? SALE_TEMPLATES[0] : preset.label,
    badgeColor: settings.defaultColor,
    badgeKind: startAsSale ? "sale" : "text",
    minDiscount: 0,
    newDays: NEW_DAYS_DEFAULT,
    shape: "rounded",
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
    catalogStats,
    initial,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  return saveCampaign({ admin, shop: session.shop, formData: await request.formData(), editingId: null });
};

export default function NewCampaignRoute() {
  const { totalProducts, plan, previewProduct, embedConfirmed, timezone, catalogStats, initial } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CampaignWizard
      initial={initial}
      totalProducts={totalProducts}
      plan={plan}
      previewProduct={previewProduct}
      embedConfirmed={embedConfirmed}
      timezone={timezone}
      catalogStats={catalogStats}
      errors={actionData?.errors ?? {}}
    />
  );
}
