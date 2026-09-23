import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { displayStatus, formatDateRange, setupSteps, statusLabel, statusTone } from "../lib/campaign";
import { fetchPreviewProducts } from "../lib/shopify-catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [campaigns, settings, previewProducts] = await Promise.all([
    db.campaign.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } }),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchPreviewProducts(admin, 1),
  ]);

  const withStatus = campaigns.map((c) => ({ ...c, computedStatus: displayStatus(c) }));
  const live = withStatus.filter((c) => c.computedStatus === "live").length;
  const scheduled = withStatus.filter((c) => c.computedStatus === "scheduled").length;
  const upcoming = withStatus.filter((c) => c.computedStatus === "live" || c.computedStatus === "scheduled").slice(0, 5);

  // Prefer the badge from the most relevant campaign; fall back to a sample
  // so the preview never looks broken on a brand-new store.
  const previewCampaign = upcoming[0] ?? withStatus[0] ?? null;

  return {
    total: campaigns.length,
    live,
    scheduled,
    upcoming,
    embedConfirmed: !!settings.embedConfirmedAt,
    previewProduct: previewProducts[0] ?? null,
    previewBadge: previewCampaign
      ? {
          text: previewCampaign.badgeText,
          color: previewCampaign.badgeColor,
          position: previewCampaign.position,
          size: previewCampaign.size,
          isSample: false,
          name: previewCampaign.badgeLabel,
          targetValue: previewCampaign.targetValue,
          endAt: previewCampaign.endAt,
        }
      : { text: "SALE -20%", color: "#E33C2B", position: "top-left", size: 12, isSample: true, name: null, targetValue: null, endAt: null },
  };
};

export default function Index() {
  const { total, live, scheduled, upcoming, embedConfirmed, previewProduct, previewBadge } = useLoaderData<typeof loader>();
  const hasCampaign = total > 0;
  const steps = setupSteps({ embedConfirmed, hasCampaign });
  const nextStep = steps.find((s) => !s.done);

  const heading = live > 0
    ? "Your badges are live"
    : hasCampaign
      ? "Your first campaign is ready"
      : "Create your first badge campaign";

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    ...(previewBadge.position.startsWith("top") ? { top: "8%" } : {}),
    ...(previewBadge.position.startsWith("bottom") ? { bottom: "8%" } : {}),
    ...(previewBadge.position.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
    ...(previewBadge.position.endsWith("left") ? { left: "8%" } : {}),
    ...(previewBadge.position.endsWith("right") ? { right: "8%" } : {}),
    background: previewBadge.color, color: "#fff", fontWeight: 700,
    padding: "4px 8px", borderRadius: 6, fontSize: 8 + previewBadge.size / 2, whiteSpace: "nowrap",
  };

  return (
    <s-page heading={heading}>
      <s-button slot="primary-action" variant="primary" href="/app/campaigns/new">
        Create campaign
      </s-button>
      <s-button slot="secondary-actions" href="/app/campaigns">
        View campaigns
      </s-button>

      <s-section>
        <s-grid gridTemplateColumns="140px 1fr" gap="large">
          <div style={{ position: "relative", aspectRatio: "1/1", overflow: "hidden", background: "#F3F2ED", borderRadius: 10, border: "1px solid #E3E2DB" }}>
            {previewProduct?.imageUrl ? (
              <img src={previewProduct.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 8 }}>
                <span style={{ fontSize: 11, color: "#9CA0A6", fontWeight: 600 }}>No product image</span>
              </div>
            )}
            <span style={overlayStyle}>{previewBadge.text}</span>
          </div>
          <s-stack direction="block" gap="base" justifyContent="center">
            <div>
              <s-text fontWeight="bold">
                {previewBadge.isSample ? "Sample preview" : previewBadge.name}
              </s-text>
              <s-box paddingBlockStart="small-100">
                <s-text color="subdued" fontSize="small">
                  {previewBadge.isSample
                    ? "Create a campaign to put your own badge here."
                    : [
                        previewBadge.targetValue,
                        previewBadge.endAt ? `ends ${formatDateRange(new Date(previewBadge.endAt), null)}` : "no end date",
                      ].filter(Boolean).join(" · ")}
                </s-text>
              </s-box>
            </div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{total}</div>
                <div style={{ fontSize: 12, color: "#6B7177" }}>Campaigns store-wide</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{live}</div>
                <div style={{ fontSize: 12, color: "#6B7177" }}>Live now</div>
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{scheduled}</div>
                <div style={{ fontSize: 12, color: "#6B7177" }}>Scheduled</div>
              </div>
            </div>
          </s-stack>
        </s-grid>
      </s-section>

      {nextStep ? (
        <s-section heading="Next step">
          <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
            <div>
              <s-text fontWeight="bold">{nextStep.label}</s-text>
              <s-box><s-text color="subdued" fontSize="small">{nextStep.description}</s-text></s-box>
            </div>
            <s-button href={nextStep.href} variant="secondary">Go</s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section>
          <s-text color="subdued" fontSize="small">✓ Setup complete</s-text>
        </s-section>
      )}

      <s-section heading="Active & upcoming">
        {upcoming.length === 0 ? (
          <s-paragraph>No live or scheduled campaigns yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="none">
            {upcoming.map((c) => (
              <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid #ECEEEC" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "inline-block", padding: "3px 8px", borderRadius: 5, background: c.badgeColor, color: "#fff", fontSize: 11, fontWeight: 700 }}>
                    {c.badgeText}
                  </span>
                  <span style={{ fontSize: 12.5, color: "#6B7177" }}>
                    {c.targetValue} · {formatDateRange(new Date(c.startAt), c.endAt ? new Date(c.endAt) : null)}
                  </span>
                </div>
                <s-badge tone={statusTone(c.computedStatus)}>{statusLabel(c.computedStatus)}</s-badge>
              </div>
            ))}
          </s-stack>
        )}
        <s-box paddingBlockStart="small-300">
          <s-link href="/app/campaigns">View all campaigns</s-link>
        </s-box>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
