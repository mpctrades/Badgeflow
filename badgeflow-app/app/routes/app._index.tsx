import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import {
  BRAND, PLANS, productsLabel, runningWindows, setupSteps, statusLabel, statusTone, storefrontStatus, type PlanId,
} from "../lib/campaign";
import { fetchPreviewProducts, fetchShopInfo, fetchTotalProductCount, formatPrice } from "../lib/shopify-catalog.server";
import { badgedProductCount, syncStorefrontIfStale } from "../lib/storefront-sync.server";
import { useEmbedStatus } from "../lib/use-embed-status";

// All dates are formatted on the server in the shop's timezone, so the
// dashboard reads the same as the storefront schedule and hydration is stable.
function dateFormatters(timeZone: string) {
  const dateTime = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });
  const dayMonthTime = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone });
  const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  return {
    dateTime: (d: Date) => dateTime.format(d),
    dayMonthTime: (d: Date) => dayMonthTime.format(d),
    dayMonth: (d: Date) => dayMonth.format(d),
    sameDay: (a: Date, b: Date) => dayKey.format(a) === dayKey.format(b),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const now = new Date();

  const [campaigns, settings, shopInfo, totalProducts, sync] = await Promise.all([
    db.campaign.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } }),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchShopInfo(admin),
    fetchTotalProductCount(admin),
    // Keeps collection membership fresh on the storefront, at most every
    // few minutes rather than on every visit.
    syncStorefrontIfStale(admin, session.shop),
  ]);
  const fmt = dateFormatters(shopInfo.ianaTimezone);

  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  const limit = PLANS[plan].limit;
  const windows = runningWindows(campaigns, plan, now);
  const withStatus = campaigns.map((c) => ({ ...c, computedStatus: storefrontStatus(c, windows, now) }));
  const live = withStatus.filter((c) => c.computedStatus === "live");
  const scheduled = withStatus
    .filter((c) => c.computedStatus === "scheduled" || c.computedStatus === "queued")
    .sort((a, b) => (windows.get(a.id)?.startAt ?? a.startAt).getTime() - (windows.get(b.id)?.startAt ?? b.startAt).getTime());
  const recent = withStatus.slice(0, 3);

  // What the storefront enforces right now (plan limits applied).
  const badgedCount = badgedProductCount(sync.config, totalProducts, now);

  const firstLive = live[0] ?? null;
  const liveDetail = firstLive
    ? `${firstLive.badgeLabel} · ${fmt.sameDay(firstLive.startAt, now) ? "started today" : `since ${fmt.dayMonth(firstLive.startAt)}`}`
    : "No campaign live right now";
  const nextStart = scheduled[0] ? (windows.get(scheduled[0].id)?.startAt ?? scheduled[0].startAt) : null;
  const scheduledDetail = scheduled[0]
    ? windows.has(scheduled[0].id) && nextStart
      ? `Next starts ${fmt.dateTime(nextStart)}`
      : `${scheduled[0].badgeLabel} is waiting for a free slot`
    : "Nothing scheduled";

  // Storefront preview: the live campaign's badge on the products it really
  // targets, or the next scheduled one, or a sample so a new store never
  // looks broken.
  const previewCampaign = firstLive ?? scheduled[0] ?? null;
  const published = previewCampaign ? sync.config?.campaigns.find((c) => c.id === previewCampaign.id) : undefined;
  const previewProducts = await fetchPreviewProducts(admin, 3, published && !published.all ? published.handles : undefined);

  const events = [...live, ...scheduled]
    .flatMap((c) => [
      ...(c.startAt > now ? [{ at: c.startAt, label: `${c.badgeLabel} starts` }] : []),
      ...(c.endAt && c.endAt > now ? [{ at: c.endAt, label: `${c.badgeLabel} ends` }] : []),
    ])
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, 4)
    .map((e) => ({ when: fmt.dateTime(e.at), label: e.label }));

  const scheduleLabel = (c: { startAt: Date; endAt: Date | null }) => {
    const started = c.startAt <= now;
    const start = started ? `Since ${fmt.dayMonth(c.startAt)}` : fmt.dayMonthTime(c.startAt);
    if (!c.endAt) return started ? `${start} · no end` : `${start} → no end`;
    return `${start} → ${fmt.dayMonth(c.endAt)}`;
  };

  const last = withStatus[0];
  // Same design (including mobile settings) and products, with a fresh schedule.
  const duplicateHref = last ? `/app/campaigns/${last.id}/edit?duplicate=1` : null;

  return {
    shopName: shopInfo.name,
    storefrontUrl: `https://${session.shop}`,
    syncFailed: !sync.ok,
    hasCampaign: campaigns.length > 0,
    embedConfirmed: !!settings.embedConfirmedAt,
    stats: {
      live: live.length,
      liveDetail,
      scheduled: scheduled.length,
      scheduledDetail,
      badgedCount,
      limit: limit === Infinity ? null : limit,
      planLabel: PLANS[plan].label,
      canUpgrade: plan !== "unlimited",
    },
    preview: {
      badge: previewCampaign
        ? { text: previewCampaign.badgeText, color: previewCampaign.badgeColor, position: previewCampaign.position, size: previewCampaign.size }
        : { text: "SALE -20%", color: "#E33C2B", position: "top-left", size: 12 },
      caption: firstLive
        ? "Products in the live campaign, as shoppers see them."
        : previewCampaign
          ? "How your next scheduled campaign will look."
          : "A sample badge — create a campaign to use your own.",
      products: previewProducts.map((p) => ({
        id: p.id,
        title: p.title,
        imageUrl: p.imageUrl,
        price: formatPrice(p.price, p.currency),
        badged: true,
      })),
    },
    events,
    totalCampaigns: campaigns.length,
    recent: recent.map((c) => ({
      id: c.id,
      name: c.badgeLabel,
      badgeText: c.badgeText,
      badgeColor: c.badgeColor,
      status: c.computedStatus,
      products: productsLabel(c),
      schedule: c.isDraft ? "Draft" : scheduleLabel(c),
    })),
    duplicateHref,
  };
};

const CSS = `
.bf-grid { display: grid; gap: 16px; }
.bf-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.bf-main { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); align-items: start; }
.bf-col { display: grid; gap: 16px; }
.bf-products { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.bf-eyebrow { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: #616161; display: flex; align-items: center; gap: 6px; }
.bf-big { font-size: 26px; font-weight: 700; line-height: 1.2; margin-top: 6px; }
.bf-muted { font-size: 12px; color: #616161; }
.bf-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bf-pill { display: inline-block; padding: 3px 7px; border-radius: 4px; color: #fff; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.bf-timeline { list-style: none; margin: 0; padding: 0; }
.bf-timeline li { position: relative; padding: 0 0 14px 20px; }
.bf-timeline li:last-child { padding-bottom: 0; }
.bf-timeline li::before { content: ""; position: absolute; left: 3px; top: 4px; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid #303030; background: #fff; }
.bf-timeline li:first-child::before { background: #303030; }
.bf-timeline li:not(:last-child)::after { content: ""; position: absolute; left: 7px; top: 14px; bottom: 2px; width: 1px; background: #D4D4D4; }
.bf-shortcut { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; font-size: 13px; color: #303030; text-decoration: none; border-bottom: 1px solid #F1F1F1; }
.bf-shortcut:last-child { border-bottom: 0; }
.bf-shortcut:hover { color: ${BRAND}; }
@media (max-width: 900px) {
  .bf-main { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .bf-stats { grid-template-columns: minmax(0, 1fr); }
  .bf-products { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bf-hide-sm { display: none; }
}
`;

function badgeOverlayStyle(badge: { color: string; position: string; size: number }): React.CSSProperties {
  const { position } = badge;
  return {
    position: "absolute",
    ...(position.startsWith("top") ? { top: 8 } : {}),
    ...(position.startsWith("bottom") ? { bottom: 8 } : {}),
    ...(position.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
    ...(position.endsWith("left") ? { left: 8 } : {}),
    ...(position.endsWith("right") ? { right: 8 } : {}),
    ...(position.endsWith("center")
      ? { left: "50%", transform: position.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" }
      : {}),
    background: badge.color, color: "#fff", fontWeight: 700,
    padding: "3px 7px", borderRadius: 4, fontSize: 7 + badge.size / 3, whiteSpace: "nowrap",
  };
}

export default function Index() {
  const {
    shopName, storefrontUrl, syncFailed, hasCampaign, embedConfirmed: embedStored, stats, preview, events, totalCampaigns, recent,
    duplicateHref,
  } = useLoaderData<typeof loader>();
  const embedConfirmed = useEmbedStatus(embedStored).active;
  const steps = setupSteps({ embedConfirmed, hasCampaign });
  const doneCount = steps.filter((s) => s.done).length;
  const nextStep = steps.find((s) => !s.done);

  const usagePct = stats.limit ? Math.min(100, (stats.badgedCount / stats.limit) * 100) : 100;
  const slotsLeft = stats.limit ? stats.limit - stats.badgedCount : null;

  const subheading = stats.live > 0 && embedConfirmed
    ? `${shopName} · badges are showing on your storefront`
    : stats.live > 0
      ? `${shopName} · turn on the app embed so shoppers can see your badges`
      : `${shopName} · no badges are showing yet`;

  return (
    <s-page heading="Welcome back" inlineSize="large">
      <style>{CSS}</style>
      <s-button slot="primary-action" variant="primary" icon="plus" href="/app/campaigns/new">
        Create campaign
      </s-button>
      <s-button slot="secondary-actions" href="/app/campaigns">
        View campaigns
      </s-button>

      <div className="bf-grid" style={{ gap: 16 }}>
        <div className="bf-muted" style={{ fontSize: 13, marginTop: -4 }}>{subheading}</div>
        {syncFailed && (
          <s-banner tone="warning" heading="Your storefront may be out of date">
            BadgeFlow couldn&apos;t update your storefront just now. Reload this page in a minute to try again.
          </s-banner>
        )}
        <div className="bf-grid bf-stats">
          <s-section>
            <div className="bf-eyebrow">
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: stats.live > 0 ? "#29845A" : "#B5B5B5" }} />
              Live now
            </div>
            <div className="bf-big">{stats.live}</div>
            <div className="bf-muted">{stats.liveDetail}</div>
          </s-section>

          <s-section>
            <div className="bf-eyebrow">
              <s-icon type="clock" size="small" />
              Scheduled
            </div>
            <div className="bf-big">{stats.scheduled}</div>
            <div className="bf-muted">{stats.scheduledDetail}</div>
          </s-section>

          <s-section>
            <div className="bf-row">
              <div className="bf-eyebrow">Products badged</div>
              {stats.canUpgrade && <s-link href="/app/plan">Upgrade</s-link>}
            </div>
            <div className="bf-big">
              {stats.badgedCount}
              {stats.limit && <span style={{ fontSize: 15, fontWeight: 500, color: "#616161" }}> / {stats.limit}</span>}
            </div>
            {stats.limit && (
              <div style={{ height: 6, borderRadius: 3, background: "#EBEBEB", overflow: "hidden", margin: "6px 0" }}>
                <div style={{ width: `${usagePct}%`, height: "100%", background: slotsLeft! <= 0 ? "#B98900" : "#303030" }} />
              </div>
            )}
            <div className="bf-muted" style={{ color: slotsLeft !== null && slotsLeft <= 5 ? "#8E1F0B" : undefined }}>
              {slotsLeft === null
                ? `Unlimited on the ${stats.planLabel} plan`
                : slotsLeft <= 0
                  ? `Limit reached — extra products show no badge on ${stats.planLabel}`
                  : `${slotsLeft} slot${slotsLeft === 1 ? "" : "s"} left on the ${stats.planLabel} plan`}
            </div>
          </s-section>
        </div>

        <div className="bf-grid bf-main">
          <div className="bf-col">
            <s-section>
              <div className="bf-row" style={{ marginBottom: 12, alignItems: "flex-start" }}>
                <div>
                  <s-heading>What shoppers see right now</s-heading>
                  <div className="bf-muted">{preview.caption}</div>
                </div>
                <s-button href={storefrontUrl} target="_blank">Open storefront</s-button>
              </div>
              {preview.products.length === 0 ? (
                <s-paragraph color="subdued">Add a product to your store to see a live preview here.</s-paragraph>
              ) : (
                <div className="bf-products">
                  {preview.products.map((p) => (
                    <div key={p.id}>
                      <div style={{ position: "relative", aspectRatio: "4/3", borderRadius: 8, overflow: "hidden", background: "#F1F1F1", border: "1px solid #E3E3E3" }}>
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <s-icon type="image" tone="neutral" />
                          </div>
                        )}
                        {p.badged && <span style={badgeOverlayStyle(preview.badge)}>{preview.badge.text}</span>}
                      </div>
                      <div style={{ fontSize: 13, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                      <div className="bf-muted">{p.price}</div>
                    </div>
                  ))}
                </div>
              )}
            </s-section>

            <s-section>
              <div className="bf-row" style={{ marginBottom: 4 }}>
                <s-heading>Recent campaigns</s-heading>
                {totalCampaigns > 0 && <s-link href="/app/campaigns">View all {totalCampaigns}</s-link>}
              </div>
              {recent.length === 0 ? (
                <s-stack direction="block" gap="base">
                  <s-paragraph color="subdued">No campaigns yet. Your first one takes about a minute.</s-paragraph>
                  <div><s-button href="/app/campaigns/new">Create campaign</s-button></div>
                </s-stack>
              ) : (
                <s-table variant="list">
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Badge</s-table-header>
                    <s-table-header listSlot="labeled">Products</s-table-header>
                    <s-table-header listSlot="labeled">Schedule</s-table-header>
                    <s-table-header listSlot="secondary">Status</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {recent.map((c) => (
                      <s-table-row key={c.id}>
                        <s-table-cell>
                          <Link to={`/app/campaigns/${c.id}/edit`} style={{ display: "flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none" }}>
                            <span className="bf-pill" style={{ background: c.badgeColor }}>{c.badgeText}</span>
                            <span>{c.name}</span>
                          </Link>
                        </s-table-cell>
                        <s-table-cell>{c.products}</s-table-cell>
                        <s-table-cell>{c.schedule}</s-table-cell>
                        <s-table-cell><s-badge tone={statusTone(c.status)}>{statusLabel(c.status)}</s-badge></s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </div>

          <div className="bf-col">
            <s-section heading="Coming up">
              {events.length === 0 ? (
                <s-paragraph color="subdued">Nothing starting or ending soon.</s-paragraph>
              ) : (
                <ul className="bf-timeline">
                  {events.map((e, i) => (
                    <li key={i}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{e.when}</div>
                      <div className="bf-muted">{e.label}</div>
                    </li>
                  ))}
                </ul>
              )}
            </s-section>

            <s-section>
              {nextStep ? (
                <s-stack direction="block" gap="small-200">
                  <s-text fontWeight="bold">Finish setup · {doneCount} of {steps.length} done</s-text>
                  <s-text color="subdued" fontSize="small">{nextStep.label}. {nextStep.description}</s-text>
                  <div><s-button href={nextStep.href}>Continue setup</s-button></div>
                </s-stack>
              ) : (
                <s-stack direction="block" gap="small-200">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <s-icon type="check-circle" tone="success" />
                    <s-text fontWeight="bold">Setup complete</s-text>
                  </div>
                  <s-text color="subdued" fontSize="small">App embed on and your first campaign created. Open your storefront any time to check how badges look.</s-text>
                  <div><s-button href="/app/setup">Review setup</s-button></div>
                </s-stack>
              )}
            </s-section>

            <s-section heading="Shortcuts">
              <div>
                <Link className="bf-shortcut" to="/app/setup">
                  Store setup and help <s-icon type="chevron-right" size="small" />
                </Link>
                {duplicateHref && (
                  <Link className="bf-shortcut" to={duplicateHref}>
                    Duplicate last campaign <s-icon type="chevron-right" size="small" />
                  </Link>
                )}
                {stats.canUpgrade && stats.limit && (
                  <Link className="bf-shortcut" to="/app/plan">
                    Raise the {stats.limit}-product limit <s-icon type="chevron-right" size="small" />
                  </Link>
                )}
              </div>
            </s-section>
          </div>
        </div>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
