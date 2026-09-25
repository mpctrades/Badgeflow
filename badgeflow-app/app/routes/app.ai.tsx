import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { PLANS, type PlanId } from "../lib/campaign";
import { fetchPreviewProducts, fetchTotalProductCount } from "../lib/shopify-catalog.server";
import type { CallbackEvent } from "@shopify/polaris-types";

const EXAMPLES = [
  { chip: "Weekend sale", text: "Badge my 20 best sellers with a -25% sale badge, running this weekend." },
  { chip: "New arrivals", text: "Put a NEW badge on anything added in the last 2 weeks." },
  { chip: "Low-stock collection", text: "Add a LOW STOCK badge to my Autumn collection." },
];

// Demo mode: no AI provider is connected yet, so every request yields the
// same fixed sample draft. The UI says so rather than pretending otherwise.
const SAMPLE_DRAFT = { text: "SALE -25%", color: "#E33C2B", colorName: "Red", size: 14, position: "top-left" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [products, totalProducts, settings] = await Promise.all([
    fetchPreviewProducts(admin, 1),
    fetchTotalProductCount(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
  ]);
  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const limit = PLANS[plan].limit;
  return {
    previewProduct: products[0] ?? null,
    totalProducts,
    planLabel: PLANS[plan].label,
    limit: limit === Infinity ? null : limit,
    isFree: plan === "free",
  };
};

const CSS = `
.bfa-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.bfa-col { display: grid; gap: 16px; }
.bfa-muted { font-size: 12px; color: #616161; }
.bfa-head { margin-bottom: 12px; }
.bfa-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bfa-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.bfa-chip { border: 1px solid #D4D4D4; background: #fff; border-radius: 999px; padding: 5px 12px; font-size: 12px; color: #303030; cursor: pointer; font: inherit; font-size: 12px; }
.bfa-chip:hover { background: #F6F6F6; border-color: #B5B5B5; }
.bfa-tile { display: flex; gap: 14px; align-items: center; background: #F6F6F6; border-radius: 10px; padding: 14px; }
.bfa-thumb { position: relative; width: 84px; height: 84px; flex: 0 0 auto; border-radius: 8px; overflow: hidden; background: #EBEBEB; border: 1px solid #E3E3E3; }
.bfa-facts { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
.bfa-facts th { text-align: left; font-weight: 400; color: #616161; padding: 10px 12px 10px 0; width: 30%; vertical-align: top; border-top: 1px solid #F1F1F1; }
.bfa-facts td { padding: 10px 0; vertical-align: top; border-top: 1px solid #F1F1F1; }
.bfa-note { display: flex; gap: 8px; align-items: flex-start; background: #F6F6F6; border-radius: 8px; padding: 10px 12px; font-size: 12px; color: #4A4A4A; margin-top: 12px; }
.bfa-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
.bfa-empty { text-align: center; padding: 40px 12px; }
@media (max-width: 800px) {
  .bfa-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 480px) {
  .bfa-actions { grid-template-columns: 1fr; }
}
`;

export default function AiAssistant() {
  const { previewProduct, totalProducts, planLabel, limit, isFree } = useLoaderData<typeof loader>();
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState<typeof SAMPLE_DRAFT | null>(null);

  function generate() {
    setDraft(SAMPLE_DRAFT);
  }

  const baseParams = draft
    ? { badgeText: draft.text, badgeColor: draft.color, size: String(draft.size), targetType: "all" }
    : null;
  const builderHref = baseParams ? `/app/campaigns/new?${new URLSearchParams(baseParams)}` : null;
  const reviewHref = baseParams ? `/app/campaigns/new?${new URLSearchParams({ ...baseParams, step: "review" })}` : null;

  const overLimit = limit !== null && totalProducts > limit;
  const planCheck = limit === null
    ? `${totalProducts} products — unlimited on the ${planLabel} plan.`
    : overLimit
      ? `All ${totalProducts} products exceed your ${limit}-product limit — ${totalProducts - limit} would show no badge.`
      : `${totalProducts} products fits your ${limit}-product limit.`;

  return (
    <s-page heading="AI assistant (Beta)" inlineSize="large">
      <style>{CSS}</style>
      <div className="bfa-muted" style={{ fontSize: 13, marginBottom: 16, marginTop: -4 }}>
        Beta: describe a campaign and get a draft to start from. You always review and publish.
      </div>

      <div className="bfa-grid">
        <div className="bfa-col">
          <s-section>
            <div className="bfa-head">
              <s-heading>What do you want to run?</s-heading>
              <div className="bfa-muted">Mention the products, the badge wording and when it should run.</div>
            </div>
            <s-stack direction="block" gap="base">
              <s-text-area
                label="Describe the campaign"
                labelAccessibilityVisibility="exclusive"
                value={request}
                rows={4}
                placeholder="e.g. Badge my 20 best sellers with a -25% sale badge, running this weekend."
                onChange={(e: CallbackEvent<"s-text-area">) => setRequest(e.currentTarget.value)}
              />
              <div className="bfa-chips">
                {EXAMPLES.map((ex) => (
                  <button type="button" key={ex.chip} className="bfa-chip" onClick={() => setRequest(ex.text)}>
                    {ex.text}
                  </button>
                ))}
              </div>
              <s-stack direction="inline" gap="small-300" alignItems="center">
                <s-button variant="primary" icon="wand" onClick={generate} disabled={!request}>
                  Draft this campaign
                </s-button>
                <span className="bfa-muted">
                  {request ? "Beta — for now it returns a sample draft you can edit." : "Describe a campaign above to draft it."}
                </span>
              </s-stack>
            </s-stack>
          </s-section>

          <s-section>
            <div className="bfa-row" style={{ alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <s-heading>Use your own AI key</s-heading>
                <div className="bfa-muted">
                  Bring an Anthropic or OpenAI key and the assistant builds real drafts from your wording, billed to
                  your own account.
                </div>
              </div>
              <s-badge tone="warning">Premium</s-badge>
            </div>
            <s-stack direction="inline" gap="small-300" alignItems="center">
              {isFree && (
                <s-button href="/app/plan">
                  See {PLANS.premium.label} — {PLANS.premium.price}{PLANS.premium.period}
                </s-button>
              )}
              <span className="bfa-muted">Coming soon — not available on any plan yet.</span>
            </s-stack>
          </s-section>
        </div>

        <s-section>
          {!draft ? (
            <div className="bfa-empty">
              <s-icon type="wand" tone="neutral" />
              <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8 }}>Your draft appears here</div>
              <div className="bfa-muted" style={{ marginTop: 4 }}>
                Describe a campaign or pick an example, then press Draft this campaign. Nothing goes live until you publish.
              </div>
            </div>
          ) : (
            <>
              <div className="bfa-row" style={{ marginBottom: 12 }}>
                <s-heading>Draft ready — review it</s-heading>
                <s-badge tone="neutral">Not published</s-badge>
              </div>

              <div className="bfa-tile">
                <div className="bfa-thumb">
                  {previewProduct?.imageUrl ? (
                    <img src={previewProduct.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <s-icon type="image" tone="neutral" />
                    </div>
                  )}
                  <span style={{ position: "absolute", top: 6, left: 6, background: draft.color, color: "#fff", fontWeight: 700, padding: "2px 6px", borderRadius: 4, fontSize: 9.5, whiteSpace: "nowrap" }}>
                    {draft.text}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 650 }}>Sample sale campaign</div>
                  <div className="bfa-muted" style={{ marginTop: 2 }}>
                    {draft.colorName} badge, top left. A fixed sample, not generated from your exact wording.
                  </div>
                </div>
              </div>

              <table className="bfa-facts">
                <tbody>
                  <tr><th>Products</th><td>All products ({totalProducts})</td></tr>
                  <tr><th>Schedule</th><td>Starts when you publish · no end date</td></tr>
                  <tr><th>Badge text</th><td>{draft.text}</td></tr>
                  <tr>
                    <th>Plan check</th>
                    <td style={{ color: overLimit ? "#8E4B00" : undefined }}>{planCheck}</td>
                  </tr>
                </tbody>
              </table>

              <div className="bfa-note">
                <s-icon type="info" size="small" />
                <span>
                  The assistant can never publish a campaign. It fills in the builder and stops — publishing is always your click.
                </span>
              </div>

              <div className="bfa-actions">
                <s-button inlineSize="fill" href={builderHref ?? undefined}>Open in the builder</s-button>
                <s-button variant="primary" inlineSize="fill" href={reviewHref ?? undefined}>Review and publish</s-button>
              </div>
            </>
          )}
        </s-section>
      </div>

      <s-box paddingBlockStart="base">
        <s-text color="subdued" fontSize="small">
          AI provider not connected — sample data only. <s-link href="/app/settings">Manage in Settings →</s-link>
        </s-text>
      </s-box>
    </s-page>
  );
}
