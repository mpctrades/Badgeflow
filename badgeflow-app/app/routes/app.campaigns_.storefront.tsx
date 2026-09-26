import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { positionLabel } from "../lib/badges";
import {
  blockingCampaign, PLANS, runningWindows, statusLabel, statusTone, storefrontStatus, type PlanId,
} from "../lib/campaign";
import { fetchPreviewProducts, fetchShopInfo, formatPrice } from "../lib/shopify-catalog.server";
import { syncStorefront, syncStorefrontIfStale } from "../lib/storefront-sync.server";
import { formatInZone } from "../lib/timezone";
import { campaignToasts, useActionToast, useQueryToast } from "../lib/use-toast";
import { useEmbedStatus } from "../lib/use-embed-status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const campaign = id
    ? await db.campaign.findFirst({ where: { id, shop: session.shop } })
    : await db.campaign.findFirst({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } });

  if (!campaign) throw redirect("/app/campaigns");

  const [shopInfo, settings, campaigns, sync] = await Promise.all([
    fetchShopInfo(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    db.campaign.findMany({ where: { shop: session.shop } }),
    syncStorefrontIfStale(admin, session.shop),
  ]);
  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const windows = runningWindows(campaigns, plan);
  const status = storefrontStatus(campaign, windows);
  const window = windows.get(campaign.id);
  const blocker = status === "queued" ? blockingCampaign(campaign, campaigns, windows) : null;

  // Only the products this campaign really badges (after plan limits).
  const published = sync.config?.campaigns.find((c) => c.id === campaign.id);
  const products = published
    ? await fetchPreviewProducts(admin, 3, published.all ? undefined : published.handles)
    : [];

  const tz = shopInfo.ianaTimezone;
  const runsFrom = window?.startAt ?? campaign.startAt;
  return {
    campaign: {
      id: campaign.id,
      name: campaign.badgeLabel,
      badgeText: campaign.badgeText,
      badgeColor: campaign.badgeColor,
      position: campaign.position,
      size: campaign.size,
      mobile:
        campaign.mobilePosition && (campaign.mobilePosition !== campaign.position || campaign.mobileSize !== campaign.size)
          ? `${positionLabel(campaign.mobilePosition)} · ${campaign.mobileSize ?? campaign.size}%`
          : null,
      target: campaign.targetValue,
    },
    status,
    schedule: `${formatInZone(runsFrom, tz)} → ${campaign.endAt ? formatInZone(campaign.endAt, tz) : "no end date"}`,
    queued:
      status === "queued"
        ? {
            startsAt: window ? formatInZone(window.startAt, tz) : null,
            blocker: blocker ? { id: blocker.id, name: blocker.badgeLabel, endless: !blocker.endAt } : null,
          }
        : null,
    notShown: !published && (status === "live" || status === "scheduled"),
    timezone: tz,
    shopName: shopInfo.name,
    embedConfirmed: !!settings.embedConfirmedAt,
    products: products.map((p) => ({ id: p.id, title: p.title, imageUrl: p.imageUrl, price: formatPrice(p.price, p.currency) })),
  };
};

// Ends the campaign holding the Free plan's single slot, so the queued one
// can start. Only ever touches a campaign in this shop.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") !== "end-blocker") return null;
  const id = String(formData.get("blockerId") ?? "");
  const { count } = await db.campaign.updateMany({ where: { id, shop: session.shop }, data: { endAt: new Date() } });
  if (count === 0) return { ok: false, isError: true, message: "That campaign no longer exists." };
  const { ok } = await syncStorefront(admin, session.shop);
  return ok
    ? { ok: true, message: "Campaign ended — this one can start now" }
    : { ok: false, isError: true, message: "Campaign ended, but your storefront couldn't be updated. Try again in a minute." };
};

function badgeStyle(position: string, size: number, color: string): React.CSSProperties {
  return {
    position: "absolute",
    ...(position.startsWith("top") ? { top: "6%" } : {}),
    ...(position.startsWith("bottom") ? { bottom: "6%" } : {}),
    ...(position.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
    ...(position.endsWith("left") ? { left: "6%" } : {}),
    ...(position.endsWith("right") ? { right: "6%" } : {}),
    ...(position.endsWith("center")
      ? { left: "50%", transform: position.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" }
      : {}),
    background: color, color: "#fff", fontWeight: 700,
    padding: "4px 8px", borderRadius: 4, fontSize: 6 + size / 2, whiteSpace: "nowrap",
  };
}

export default function StorefrontPreview() {
  const { campaign, status, schedule, queued, notShown, timezone, shopName, embedConfirmed, products } =
    useLoaderData<typeof loader>();
  const embedOn = useEmbedStatus(embedConfirmed).active;
  useQueryToast(campaignToasts(embedOn));
  useActionToast(useActionData<typeof action>());
  const submit = useSubmit();
  const ending = useNavigation().state !== "idle";
  const blocker = queued?.blocker ?? null;

  return (
    <s-page heading={campaign.name}>
      <s-link slot="breadcrumb-actions" href="/app/campaigns">Campaigns</s-link>
      <s-button slot="primary-action" href={`/app/campaigns/${campaign.id}/edit`}>Edit campaign</s-button>

      <s-stack direction="block" gap="base">
        {!embedOn && (
          <s-banner tone="warning" heading="Shoppers can't see badges yet">
            The BadgeFlow app embed is off in your theme. <s-link href="/app/setup">Turn it on</s-link>
          </s-banner>
        )}
        {queued && (
          <s-banner tone="warning" heading={queued.startsAt ? `Waiting its turn — starts ${queued.startsAt}` : "Waiting for a free slot"}>
            {blocker
              ? blocker.endless
                ? <>The Free plan shows one campaign at a time. <s-text fontWeight="bold">{blocker.name}</s-text> is live with no end date, so this campaign can&apos;t start until you end it or upgrade.</>
                : <>The Free plan shows one campaign at a time. This one starts when <s-text fontWeight="bold">{blocker.name}</s-text> ends.</>
              : "The Free plan shows one campaign at a time, so this one waits for the campaign before it."}
            {blocker && (
              <s-button slot="secondary-actions" command="--show" commandFor="bf-end-blocker">
                End {blocker.name} now
              </s-button>
            )}
            {blocker && (
              <s-button slot="secondary-actions" href={`/app/campaigns/${blocker.id}/edit`}>
                Edit {blocker.endless ? "its end date" : "it"}
              </s-button>
            )}
            <s-button slot="secondary-actions" href="/app/plan">See plans</s-button>
          </s-banner>
        )}
        {blocker && (
          <s-modal id="bf-end-blocker" heading={`End ${blocker.name} now?`}>
            <s-paragraph>
              Its badges disappear from your storefront right away, and <s-text fontWeight="bold">{campaign.name}</s-text>{" "}
              takes its place if its schedule has started.
            </s-paragraph>
            <s-button
              slot="primary-action"
              tone="critical"
              variant="primary"
              loading={ending}
              command="--hide"
              commandFor="bf-end-blocker"
              onClick={() => submit({ intent: "end-blocker", blockerId: blocker.id }, { method: "post" })}
            >
              End campaign
            </s-button>
            <s-button slot="secondary-actions" command="--hide" commandFor="bf-end-blocker">Cancel</s-button>
          </s-modal>
        )}
        {notShown && (
          <s-banner tone="warning">
            None of this campaign&apos;s products fit in your plan&apos;s product limit right now, so it shows no badges.{" "}
            <s-link href="/app/plan">See plans</s-link>
          </s-banner>
        )}

        <s-section heading="Campaign">
          <s-stack direction="block" gap="small-200">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-badge tone={statusTone(status)}>{statusLabel(status)}</s-badge>
              <s-text>{schedule}</s-text>
            </s-stack>
            <s-text color="subdued" fontSize="small">
              Products: {campaign.target} · Position: {positionLabel(campaign.position)} · {campaign.size}%
              {campaign.mobile ? ` · Mobile: ${campaign.mobile}` : ""} · Times in {timezone}
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading={`How it looks at ${shopName}`}>
          {products.length === 0 ? (
            <s-paragraph color="subdued">
              No products to preview — this campaign isn&apos;t badging any products right now.
            </s-paragraph>
          ) : (
            <s-grid gridTemplateColumns="repeat(auto-fill, minmax(160px, 1fr))" gap="base">
              {products.map((p) => (
                <s-box key={p.id} border="base" borderRadius="base" overflow="hidden">
                  <div style={{ position: "relative", aspectRatio: "1/1", background: "#F1F1F1" }}>
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <s-icon type="image" tone="neutral" />
                      </div>
                    )}
                    <span style={badgeStyle(campaign.position, campaign.size, campaign.badgeColor)}>{campaign.badgeText}</span>
                  </div>
                  <s-box padding="small-200">
                    <s-text fontWeight="bold">{p.title}</s-text>
                    <s-text color="subdued" fontSize="small">{p.price}</s-text>
                  </s-box>
                </s-box>
              ))}
            </s-grid>
          )}
          <s-box paddingBlockStart="base">
            <s-text color="subdued" fontSize="small">
              A close approximation — your theme decides the exact card layout. Badges only appear during the
              campaign&apos;s schedule.
            </s-text>
          </s-box>
        </s-section>
      </s-stack>
    </s-page>
  );
}
