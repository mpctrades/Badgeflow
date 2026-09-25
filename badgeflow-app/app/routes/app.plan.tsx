import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { displayStatus, PLANS, type PlanId } from "../lib/campaign";
import { fetchProductIdsForTarget } from "../lib/shopify-catalog.server";
import { useToast } from "../components/toast";
import { pricingAdminLink, refreshPlan } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // Shopify redirects here after the merchant approves a plan (the plan's
  // welcome link), so skip the cache and read the new plan straight away.
  const force = url.searchParams.has("plan_handle") || url.searchParams.has("refresh");
  const [campaigns, billing] = await Promise.all([
    db.campaign.findMany({ where: { shop: session.shop } }),
    refreshPlan(admin, session.shop, { force }),
  ]);

  const live = campaigns.filter((c) => displayStatus(c) === "live");
  const scheduledCount = campaigns.filter((c) => displayStatus(c) === "scheduled").length;

  // Real metering: union of distinct product IDs across live campaigns, so a
  // product in two campaigns still counts once.
  const idSets = await Promise.all(live.map((c) => fetchProductIdsForTarget(admin, c)));
  const badgedProductIds = new Set(idSets.flat());
  const overlapExists = idSets.reduce((sum, s) => sum + s.length, 0) > badgedProductIds.size;

  return {
    liveCampaignCount: live.length,
    scheduledCount,
    badgedProductCount: badgedProductIds.size,
    overlapExists,
    plan: billing.plan,
    billing,
    // App Bridge turns shopify:admin links into top-level admin navigation,
    // which is how an embedded app reaches Shopify's plan selection page.
    pricingUrl: pricingAdminLink(),
  };
};

const ORDER: PlanId[] = ["free", "premium", "unlimited"];

// Feature rows per plan: `true` = included (check), `false` = not included (dash).
const FEATURES: Record<PlanId, { label: string; included: boolean }[]> = {
  free: [
    { label: `Badges on ${PLANS.free.limit} products`, included: true },
    { label: `${PLANS.free.liveCampaignLimit} campaign live at a time`, included: true },
    { label: "Full badge library and scheduling", included: true },
    { label: "Multi-badge and priority rules", included: false },
    { label: "Your own AI key", included: false },
  ],
  premium: [
    { label: `Badges on ${PLANS.premium.limit} products`, included: true },
    { label: "Unlimited live campaigns", included: true },
    { label: "Multi-badge and priority rules", included: true },
    { label: "Your own AI key and MCP — coming soon", included: true },
  ],
  unlimited: [
    { label: "Everything in Premium", included: true },
    { label: "Unlimited products with badges", included: true },
    { label: "Unlimited live campaigns", included: true },
  ],
};

const TAGLINES: Record<PlanId, string> = {
  free: "Enough to prove badges lift your conversion.",
  premium: "For growing catalogues running several campaigns at once.",
  unlimited: `For catalogues above ${PLANS.premium.limit} products.`,
};

const CSS = `
.bfp-muted { font-size: 12px; color: #616161; }
.bfp-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bfp-toggle { display: inline-flex; background: #F1F1F1; border-radius: 8px; padding: 3px; }
.bfp-toggle button { border: 0; background: transparent; font: inherit; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; cursor: pointer; color: #616161; }
.bfp-toggle button[aria-pressed="true"] { background: #303030; color: #fff; }
.bfp-strip { display: grid; grid-template-columns: 160px minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.bfp-eyebrow { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: #616161; }
.bfp-bar { height: 6px; border-radius: 3px; background: #EBEBEB; overflow: hidden; margin: 6px 0; }
.bfp-bar > div { height: 100%; }
.bfp-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: stretch; margin-top: 16px; }
.bfp-card { display: flex; flex-direction: column; background: #fff; border: 1px solid #E3E3E3; border-radius: 12px; padding: 20px; box-shadow: 0 1px 0 rgba(0,0,0,.05); }
.bfp-card-rec { border: 2px solid #303030; padding: 19px; }
.bfp-chip { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #F1F1F1; color: #303030; white-space: nowrap; }
.bfp-chip-dark { background: #303030; color: #fff; }
.bfp-price { font-size: 30px; font-weight: 700; line-height: 1.1; margin-top: 12px; }
.bfp-price span { font-size: 13px; font-weight: 500; color: #616161; }
.bfp-list { list-style: none; margin: 14px 0 0; padding: 0; font-size: 13px; }
.bfp-list li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
.bfp-list li.bfp-off { color: #8A8A8A; }
@media (max-width: 900px) {
  .bfp-cards { grid-template-columns: minmax(0, 1fr); }
  .bfp-strip { grid-template-columns: minmax(0, 1fr); gap: 14px; }
}
`;

function monthlyPrice(id: PlanId): number {
  return Number(PLANS[id].price.replace(/[^0-9.]/g, "")) || 0;
}

export default function Plan() {
  const { liveCampaignCount, scheduledCount, badgedProductCount, overlapExists, plan, billing, pricingUrl } =
    useLoaderData<typeof loader>();
  // Shopify redirects to /app/plan?plan_handle=… after the merchant approves a plan.
  const { show } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (!searchParams.has("plan_handle")) return;
    show(`You're on ${PLANS[plan].label} — thanks for choosing BadgeFlow`);
    const next = new URLSearchParams(searchParams);
    next.delete("plan_handle");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [annual, setAnnual] = useState(false);

  const current = PLANS[plan];
  const limit = current.limit;
  const liveLimit = current.liveCampaignLimit;
  const wantedCampaigns = liveCampaignCount + scheduledCount;

  // The cheapest plan that fits today's usage: every badged product shows, and
  // every live + scheduled campaign can run at the same time.
  // Only ever recommends an upgrade: if the current plan already fits, nothing
  // is recommended (never suggest a cheaper plan as "fits your store").
  const fitting =
    ORDER.find((id) => PLANS[id].limit >= badgedProductCount && PLANS[id].liveCampaignLimit >= wantedCampaigns) ??
    "unlimited";
  const recommended: PlanId | null = ORDER.indexOf(fitting) > ORDER.indexOf(plan) ? fitting : null;

  const pct = (n: number, max: number) => (max === Infinity ? 100 : Math.min(100, (n / Math.max(max, 1)) * 100));
  const barColor = (n: number, max: number) => (n > max ? "#C70A24" : n / max >= 0.8 ? "#B98900" : "#303030");

  function planPitch(id: PlanId): string {
    if (id !== recommended || id === plan) return TAGLINES[id];
    const p = PLANS[id];
    const parts: string[] = [];
    if (limit !== Infinity) {
      parts.push(
        `You're using ${badgedProductCount} of ${limit} slots — this gives you ${
          p.limit === Infinity ? "unlimited products" : `${p.limit - limit} more`
        }`,
      );
    }
    if (wantedCampaigns > liveLimit) parts.push(`lets all ${wantedCampaigns} campaigns run together`);
    return parts.length ? `${parts.join(" and ")}.` : TAGLINES[id];
  }

  function priceLine(id: PlanId) {
    const monthly = monthlyPrice(id);
    if (monthly === 0) return { amount: "$0", period: "for life" };
    return annual
      ? { amount: `$${(monthly * 10).toFixed(2)}`, period: "/year" }
      : { amount: PLANS[id].price, period: PLANS[id].period };
  }

  return (
    <s-page heading="Plan & billing" inlineSize="large">
      <style>{CSS}</style>
      <div className="bfp-row" style={{ marginTop: -4, marginBottom: 16, flexWrap: "wrap" }}>
        <div className="bfp-muted" style={{ fontSize: 13 }}>
          Change or cancel any time — billed through Shopify with your store invoice.
        </div>
        <div className="bfp-toggle" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={!annual} onClick={() => setAnnual(false)}>Monthly</button>
          <button type="button" aria-pressed={annual} onClick={() => setAnnual(true)}>Annual — 2 months free</button>
        </div>
      </div>

      <s-section>
        <div className="bfp-strip">
          <div>
            <div className="bfp-eyebrow">Current plan</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
              {current.label}{" "}
              <span className="bfp-muted" style={{ fontWeight: 500 }}>
                {monthlyPrice(plan) === 0 ? "$0 for life" : `${current.price}${current.period}`}
              </span>
            </div>
            {billing.trialEndsAt && (
              <div className="bfp-muted">Free trial until {new Date(billing.trialEndsAt).toLocaleDateString()}</div>
            )}
            {billing.cancelAtEndOfCycle && <div className="bfp-muted">Cancels at the end of this billing cycle</div>}
            {billing.pendingPlan && billing.pendingPlan !== plan && (
              <div className="bfp-muted">Changes to {PLANS[billing.pendingPlan].label} next billing cycle</div>
            )}
            {billing.error && <div className="bfp-muted" style={{ color: "#8E1F0B" }}>{billing.error}</div>}
          </div>
          <div>
            <div className="bfp-row" style={{ fontSize: 12 }}>
              <span>Products carrying a badge</span>
              <span style={{ fontWeight: 600 }}>{badgedProductCount} / {limit === Infinity ? "∞" : limit}</span>
            </div>
            <div className="bfp-bar">
              <div style={{ width: `${pct(badgedProductCount, limit)}%`, background: barColor(badgedProductCount, limit) }} />
            </div>
            <div className="bfp-muted">
              {limit !== Infinity && badgedProductCount > limit
                ? `${badgedProductCount - limit} products are past the limit and show no badge — nothing breaks.`
                : "Products past the limit simply show no badge — nothing breaks."}
              {overlapExists && " A product in two live campaigns counts once."}
            </div>
          </div>
          <div>
            <div className="bfp-row" style={{ fontSize: 12 }}>
              <span>Campaigns live at once</span>
              <span style={{ fontWeight: 600 }}>{liveCampaignCount} / {liveLimit === Infinity ? "∞" : liveLimit}</span>
            </div>
            <div className="bfp-bar">
              <div style={{ width: `${pct(liveCampaignCount, liveLimit)}%`, background: barColor(liveCampaignCount, liveLimit) }} />
            </div>
            <div className="bfp-muted">
              {scheduledCount > 0 && liveLimit !== Infinity && wantedCampaigns > liveLimit
                ? `Your ${scheduledCount} scheduled campaign${scheduledCount === 1 ? "" : "s"} will queue behind the live one.`
                : scheduledCount > 0
                  ? `${scheduledCount} scheduled campaign${scheduledCount === 1 ? "" : "s"} can go live on time.`
                  : "No campaigns waiting to go live."}
            </div>
          </div>
        </div>
      </s-section>

      <div className="bfp-cards">
        {ORDER.map((id) => {
          const p = PLANS[id];
          const isCurrent = id === plan;
          const isRec = id === recommended && !isCurrent;
          const price = priceLine(id);
          return (
            <div key={id} className={`bfp-card${isRec ? " bfp-card-rec" : ""}`}>
              <div className="bfp-row">
                <s-heading>{p.label}</s-heading>
                {isCurrent && <span className="bfp-chip">Your plan</span>}
                {isRec && <span className="bfp-chip bfp-chip-dark">Fits your store</span>}
              </div>
              <div className="bfp-price">
                {price.amount} <span>{price.period}</span>
              </div>
              {annual && monthlyPrice(id) > 0 && (
                <div className="bfp-muted">${(monthlyPrice(id) * 2).toFixed(2)} saved vs monthly</div>
              )}
              <div className="bfp-muted" style={{ marginTop: 8, fontSize: 13 }}>{planPitch(id)}</div>
              <ul className="bfp-list">
                {FEATURES[id].map((f) => (
                  <li key={f.label} className={f.included ? undefined : "bfp-off"}>
                    <s-icon type={f.included ? "check" : "minus"} size="small" tone={f.included ? "success" : "neutral"} />
                    <span>{f.label}</span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: "auto", paddingTop: 20 }}>
                {isCurrent ? (
                  <s-button inlineSize="fill" disabled>Current plan</s-button>
                ) : (
                  // Shopify's plan selection page handles approval, decline,
                  // proration and trials.
                  <s-button href={pricingUrl} inlineSize="fill" variant={isRec ? "primary" : "secondary"}>
                    {ORDER.indexOf(id) > ORDER.indexOf(plan) ? `Upgrade to ${p.label}` : `Switch to ${p.label}`}
                  </s-button>
                )}
                <div className="bfp-muted" style={{ textAlign: "center", marginTop: 8, minHeight: 16 }}>
                  {isRec && !isCurrent ? "You'll approve the charge on Shopify's next screen." : id === "unlimited" && recommended !== "unlimited" ? "Most stores don't need this yet." : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bfp-muted" style={{ marginTop: 16 }}>
        Downgrading keeps every campaign — badges beyond the new limit stop showing until you upgrade again. Nothing is deleted.
      </div>
      <div className="bfp-muted" style={{ marginTop: 6 }}>
        Charges appear on your Shopify invoice. Declining on Shopify&apos;s page keeps you on your current plan.
      </div>
    </s-page>
  );
}
