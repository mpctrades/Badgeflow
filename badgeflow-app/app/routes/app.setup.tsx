import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { displayStatus, PLANS, setupSteps, type PlanId } from "../lib/campaign";
import { fetchPreviewProducts, fetchProductIdsForTarget } from "../lib/shopify-catalog.server";
import { useActionToast } from "../lib/use-toast";
import { fetchEmbedStatus, themeEditorEmbedLink } from "../lib/storefront-sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [storedSettings, campaigns, previewProducts, embed] = await Promise.all([
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    db.campaign.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } }),
    fetchPreviewProducts(admin, 1),
    fetchEmbedStatus(admin),
  ]);
  const themeName = embed.themeName;

  // The live theme is the source of truth: record when the embed is found on,
  // and clear the flag if the merchant later switched it off. If the theme
  // couldn't be read, keep whatever the merchant confirmed manually.
  let settings = storedSettings;
  if (embed.checked && embed.enabled !== !!storedSettings.embedConfirmedAt) {
    settings = await db.shopSettings.update({
      where: { shop: session.shop },
      data: { embedConfirmedAt: embed.enabled ? new Date() : null },
    });
  }

  const live = campaigns.filter((c) => displayStatus(c) === "live");
  const liveIds = await Promise.all(live.map((c) => fetchProductIdsForTarget(admin, c)));
  const badgedProductCount = new Set(liveIds.flat()).size;

  // Summary line for the "campaign created" step: prefer a live campaign.
  const featured = live[0] ?? campaigns[0] ?? null;
  const featuredIdx = featured ? live.indexOf(featured) : -1;
  const featuredProducts = featured
    ? featured.targetType === "all"
      ? "all products"
      : `${(featuredIdx >= 0 ? liveIds[featuredIdx]! : await fetchProductIdsForTarget(admin, featured)).length} products`
    : null;

  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const product = previewProducts[0] ?? null;

  return {
    settings,
    campaignCount: campaigns.length,
    storefrontUrl: `https://${session.shop}`,
    themeName,
    embedAutoChecked: embed.checked,
    // eslint-disable-next-line no-undef
    editorLink: themeEditorEmbedLink(process.env.SHOPIFY_API_KEY || ""),
    featured: featured
      ? {
          name: featured.badgeLabel,
          isLive: featuredIdx >= 0,
          products: featuredProducts,
          badgeText: featured.badgeText,
          badgeColor: featured.badgeColor,
        }
      : null,
    product: product
      ? {
          title: product.title,
          imageUrl: product.imageUrl,
          price: formatPrice(product.price, product.currency),
        }
      : null,
    plan,
    badgedProductCount,
  };
};

function formatPrice(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("intent") === "confirm-embed") {
    await db.shopSettings.upsert({
      where: { shop: session.shop },
      update: { embedConfirmedAt: new Date() },
      create: { shop: session.shop, embedConfirmedAt: new Date() },
    });
    return { ok: true, message: "Theme embed confirmed" };
  }
  return null;
};

const CSS = `
.bfs-main { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.bfs-col { display: grid; gap: 16px; }
.bfs-muted { font-size: 12px; color: #616161; }
.bfs-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bfs-bar { height: 6px; border-radius: 3px; background: #EBEBEB; overflow: hidden; }
.bfs-bar > div { height: 100%; }
.bfs-step { display: flex; gap: 12px; padding: 14px 0; border-top: 1px solid #F1F1F1; }
.bfs-step-current { background: #F7F7F7; margin: 0 -16px; padding: 16px; }
.bfs-dot { flex: 0 0 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
.bfs-dot-done { background: #CDFEE1; color: #0C5132; }
.bfs-dot-next { background: #303030; color: #fff; }
.bfs-dot-todo { background: #fff; color: #616161; border: 1px solid #D4D4D4; }
.bfs-chip { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; background: #F1F1F1; color: #303030; white-space: nowrap; }
.bfs-card { width: 150px; flex: 0 0 150px; border: 1px solid #E3E3E3; border-radius: 8px; overflow: hidden; background: #fff; }
.bfs-help summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 11px 0; font-size: 13px; border-bottom: 1px solid #F1F1F1; }
.bfs-help summary::-webkit-details-marker { display: none; }
.bfs-help[open] summary s-icon { transform: rotate(90deg); }
.bfs-help p { margin: 8px 0 12px; font-size: 12px; color: #616161; }
@media (max-width: 900px) { .bfs-main { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .bfs-preview { flex-direction: column; } }
`;

const HELP = [
  {
    q: "Badge hidden behind my theme's image",
    a: "Some themes layer hover images or overlays on product cards. Try a different position (top-right often works), and make sure the BadgeFlow app embed is on in the theme editor.",
  },
  {
    q: "Badge too big on mobile",
    a: "Badge size is a share of the product image, so it scales with the card. Lower the size, or set a separate mobile position and size in the campaign's design step.",
  },
  {
    q: "Nothing shows after enabling the block",
    a: "Check the campaign is Live (not Scheduled or Draft), that the product is in its target, and that you saved the theme editor. Then hard-refresh the storefront.",
  },
];

export default function Setup() {
  const { settings, campaignCount, storefrontUrl, themeName, embedAutoChecked, editorLink, featured, product, plan, badgedProductCount } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  useActionToast(actionData);
  const embedConfirmed = !!settings.embedConfirmedAt;
  const steps = setupSteps({ embedConfirmed, hasCampaign: campaignCount > 0 });
  const doneCount = steps.filter((s) => s.done).length;
  const left = steps.length - doneCount;
  const nextKey = steps.find((s) => !s.done)?.key ?? null;

  const words = ["None", "One", "Two", "Three"];
  const subtitle =
    left === 0
      ? "All done — your badges can appear on your storefront."
      : doneCount === 0
        ? "About two minutes from start to finish."
        : `${words[doneCount] ?? doneCount} ${doneCount === 1 ? "is" : "are"} already done. ${words[left] ?? left} left — about ${left * 60} seconds.`;

  const planInfo = PLANS[plan];
  const limit = planInfo.limit === Infinity ? null : planInfo.limit;
  const usagePct = limit ? Math.min(100, (badgedProductCount / limit) * 100) : 100;

  const badge = featured ?? { badgeText: "SALE -20%", badgeColor: "#E33C2B" };

  function stepBody(key: string) {
    if (key === "embed") {
      return (
        <s-stack direction="block" gap="small-200">
          <div className="bfs-muted">
            Click the button below. Your theme editor{themeName ? ` (${themeName})` : ""} opens with the BadgeFlow
            embed already switched on — just click <strong>Save</strong>, then come back to this page.
          </div>
          <s-stack direction="inline" gap="small-200">
            <s-button href={editorLink} target="_top" variant="primary">
              Turn on in theme editor
            </s-button>
            {embedAutoChecked ? (
              <s-button href="/app/setup">I&apos;ve saved — check again</s-button>
            ) : (
              <Form method="post">
                <input type="hidden" name="intent" value="confirm-embed" />
                <s-button type="submit" loading={busy}>I&apos;ve enabled the embed</s-button>
              </Form>
            )}
          </s-stack>
          <div className="bfs-muted">
            {embedAutoChecked
              ? "BadgeFlow checks your live theme automatically each time you open this page."
              : "We couldn't read your theme just now, so confirm it yourself once the embed is on."}
          </div>
        </s-stack>
      );
    }
    if (key === "campaign") {
      return (
        <s-stack direction="block" gap="small-200">
          <div className="bfs-muted">Pick a badge, choose which products get it, and set a schedule.</div>
          <div><s-button href="/app/campaigns/new" variant="primary">Create campaign</s-button></div>
        </s-stack>
      );
    }
    return (
      <s-stack direction="block" gap="base">
        <div className="bfs-muted">
          Open your shop in a new tab and check a product card. If the badge sits awkwardly on your theme, change
          its position or size and the storefront updates straight away.
        </div>
        <div className="bfs-preview" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
          <div className="bfs-card">
            <div style={{ position: "relative", aspectRatio: "4/3", background: "#F1F1F1" }}>
              {product?.imageUrl ? (
                <img src={product.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <s-icon type="image" tone="neutral" />
                </div>
              )}
              <span style={{ position: "absolute", top: 6, left: 6, background: badge.badgeColor, color: "#fff", fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 3 }}>
                {badge.badgeText}
              </span>
            </div>
            <div style={{ padding: "6px 8px" }}>
              <div style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {product?.title ?? "Your product"}
              </div>
              {product && <div className="bfs-muted">{product.price}</div>}
            </div>
          </div>
          <div className="bfs-muted" style={{ maxWidth: 240 }}>
            This is what you&apos;re looking for — the badge sitting cleanly above the image, never covering the price.
          </div>
        </div>
        <div>
          <s-button href={storefrontUrl} target="_blank" variant="primary" icon="external">Open my storefront</s-button>
        </div>
      </s-stack>
    );
  }

  function stepAside(key: string) {
    if (key === "embed") {
      return <s-link href={editorLink} target="_top">Change</s-link>;
    }
    if (key === "campaign" && campaignCount > 0) {
      return <Link to="/app/campaigns">View {campaignCount} campaign{campaignCount === 1 ? "" : "s"}</Link>;
    }
    return null;
  }

  function stepDoneText(key: string) {
    if (key === "embed") {
      return `BadgeFlow can draw on your product cards${themeName ? ` in the ${themeName} theme` : ""}.`;
    }
    if (key === "campaign" && featured) {
      return featured.isLive
        ? `${featured.name} is live on ${featured.products}.`
        : `${featured.name} is ready for ${featured.products}.`;
    }
    return "Your badge is showing on a real product card.";
  }

  return (
    <s-page heading="Your first badge, in three steps" inlineSize="large">
      <style>{CSS}</style>
      <div className="bfs-muted" style={{ fontSize: 13, marginTop: -4, marginBottom: 16 }}>{subtitle}</div>

      <div className="bfs-main">
        <s-section>
          <div className="bfs-row" style={{ marginBottom: 8 }}>
            <s-text fontWeight="bold">Setup progress</s-text>
            <span className="bfs-muted">{doneCount} of {steps.length} done</span>
          </div>
          <div className="bfs-bar" style={{ marginBottom: 8 }}>
            <div style={{ width: `${(doneCount / steps.length) * 100}%`, background: "#29845A" }} />
          </div>

          {steps.map((step, i) => {
            const isNext = step.key === nextKey;
            const aside = step.done ? stepAside(step.key) : null;
            return (
              <div key={step.key} className={`bfs-step${isNext ? " bfs-step-current" : ""}`}>
                <div className={`bfs-dot ${step.done ? "bfs-dot-done" : isNext ? "bfs-dot-next" : "bfs-dot-todo"}`}>
                  {step.done ? <s-icon type="check" size="small" /> : i + 1}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="bfs-row" style={{ alignItems: "flex-start" }}>
                    <div>
                      <s-text fontWeight="bold">{step.done ? doneLabel(step.key) : step.label}</s-text>
                      {step.done && <div className="bfs-muted">{stepDoneText(step.key)}</div>}
                    </div>
                    {aside && <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{aside}</span>}
                  </div>
                  {isNext && <div style={{ marginTop: 8 }}>{stepBody(step.key)}</div>}
                  {!step.done && !isNext && <div className="bfs-muted">{step.description}</div>}
                </div>
              </div>
            );
          })}

          {left === 0 && (
            <div style={{ borderTop: "1px solid #F1F1F1", paddingTop: 14 }}>
              <s-stack direction="inline" gap="small-200">
                <s-button href={storefrontUrl} target="_blank" variant="primary" icon="external">Open my storefront</s-button>
                <s-button href="/app/campaigns/new">Create another campaign</s-button>
              </s-stack>
            </div>
          )}
        </s-section>

        <div className="bfs-col">
          <s-section>
            <div className="bfs-row" style={{ marginBottom: 6 }}>
              <s-text fontWeight="bold">You&apos;re on {planInfo.label}</s-text>
              {plan === "free" && <span className="bfs-chip">No card needed</span>}
            </div>
            <div className="bfs-muted" style={{ marginBottom: 12 }}>
              {plan === "free"
                ? `Free for life — badges on ${PLANS.free.limit} products, ${PLANS.free.liveCampaignLimit} live campaign, the whole badge library and scheduling.`
                : `${planInfo.price}${planInfo.period} — ${limit ? `badges on ${limit} products` : "unlimited products"} and unlimited live campaigns.`}
            </div>
            <div className="bfs-row" style={{ fontSize: 12, marginBottom: 4 }}>
              <span>Products badged</span>
              <span>{badgedProductCount}{limit ? ` / ${limit}` : ""}</span>
            </div>
            {limit && (
              <div className="bfs-bar" style={{ marginBottom: 12 }}>
                <div style={{ width: `${usagePct}%`, background: badgedProductCount > limit ? "#C70A24" : "#303030" }} />
              </div>
            )}
            <s-button href="/app/plan">Compare plans</s-button>
          </s-section>

          <s-section heading="If something looks off">
            {HELP.map((h) => (
              <details key={h.q} className="bfs-help">
                <summary>
                  {h.q}
                  <s-icon type="chevron-right" size="small" />
                </summary>
                <p>{h.a}</p>
              </details>
            ))}
          </s-section>
        </div>
      </div>
    </s-page>
  );
}

function doneLabel(key: string): string {
  if (key === "embed") return "Theme block turned on";
  if (key === "campaign") return "First campaign created";
  return "Checked on your storefront";
}
