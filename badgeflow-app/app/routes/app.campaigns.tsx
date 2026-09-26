import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  BRAND, displayStatus, PLANS, productsLabel, runningWindows, statusTone, storefrontStatus, type CampaignStatus, type PlanId,
} from "../lib/campaign";
import { positionLabel } from "../lib/badges";
import { fetchShopInfo } from "../lib/shopify-catalog.server";
import { campaignToasts, useActionToast, useQueryToast } from "../lib/use-toast";
import { syncStorefront } from "../lib/storefront-sync.server";

type SortKey = "newest" | "oldest" | "start";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "start", label: "Start date" },
];

// Dates are formatted on the server in the shop's timezone so the schedule
// column matches what the storefront actually does.
function dateFormatters(timeZone: string) {
  const dayMonthTime = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });
  const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone });
  const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });
  return {
    dayMonthTime: (d: Date) => dayMonthTime.format(d),
    dayMonth: (d: Date) => dayMonth.format(d),
    // Whole calendar days between two instants, in the shop's timezone.
    daysBetween: (from: Date, to: Date) =>
      Math.round((Date.parse(dayKey.format(to)) - Date.parse(dayKey.format(from))) / 86_400_000),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const statusFilter = url.searchParams.get("status") ?? "all";
  const sortParam = url.searchParams.get("sort");
  const sort: SortKey = SORTS.some((s) => s.key === sortParam) ? (sortParam as SortKey) : "newest";
  const now = new Date();

  const [allCampaigns, shopInfo, settings] = await Promise.all([
    db.campaign.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } }),
    fetchShopInfo(admin),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
  ]);
  const fmt = dateFormatters(shopInfo.ianaTimezone);
  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  // On Free, a campaign that is live by its dates may be waiting its turn.
  const windows = runningWindows(allCampaigns, plan, now);

  const all = allCampaigns.map((c) => ({
    ...c,
    computedStatus: displayStatus(c, now),
    shownStatus: storefrontStatus(c, windows, now),
  }));
  const totals = { all: all.length, live: all.filter((c) => c.shownStatus === "live").length };

  const needle = q.trim().toLowerCase();
  const matching = needle
    ? all.filter((c) => [c.badgeText, c.badgeLabel, c.targetValue].some((v) => v.toLowerCase().includes(needle)))
    : all;

  const counts: Record<CampaignStatus | "all", number> = {
    all: matching.length,
    draft: matching.filter((c) => c.computedStatus === "draft").length,
    live: matching.filter((c) => c.computedStatus === "live").length,
    scheduled: matching.filter((c) => c.computedStatus === "scheduled").length,
    ended: matching.filter((c) => c.computedStatus === "ended").length,
  };

  const filtered = (statusFilter === "all" ? matching : matching.filter((c) => c.computedStatus === statusFilter))
    .slice()
    .sort((a, b) => {
      if (sort === "oldest") return a.createdAt.getTime() - b.createdAt.getTime();
      if (sort === "start") return a.startAt.getTime() - b.startAt.getTime();
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  const statusText = (c: (typeof all)[number]): string => {
    if (c.shownStatus === "queued") return "Queued";
    if (c.computedStatus === "scheduled") {
      const days = fmt.daysBetween(now, c.startAt);
      return days <= 0 ? "Starts today" : days === 1 ? "Tomorrow" : `In ${days} days`;
    }
    return c.computedStatus[0]!.toUpperCase() + c.computedStatus.slice(1);
  };

  return {
    q,
    statusFilter,
    sort,
    totals,
    counts,
    campaigns: filtered.map((c) => ({
      id: c.id,
      name: c.badgeLabel,
      badgeText: c.badgeText,
      badgeColor: c.badgeColor,
      placement: `${positionLabel(c.position)} · ${c.size}% of image`,
      products: productsLabel(c),
      scheduleStart: c.startAt <= now ? `Since ${fmt.dayMonth(c.startAt)}` : fmt.dayMonthTime(c.startAt),
      scheduleEnd: c.endAt ? `${c.endAt <= now ? "Ended" : "Ends"} ${fmt.dayMonthTime(c.endAt)}` : "No end date",
      status: c.computedStatus,
      tone: statusTone(c.shownStatus),
      statusText: statusText(c),
    })),
    embedConfirmed: !!settings.embedConfirmedAt,
    freePlan: plan === "free",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = String(formData.get("id"));

  // Every change republishes the storefront; say so plainly if that failed,
  // instead of claiming the badges changed.
  async function done(message: string) {
    const { ok } = await syncStorefront(admin, session.shop);
    return ok
      ? { ok: true, message }
      : { ok: false, isError: true, message: `${message}, but your storefront couldn't be updated. Try again in a minute.` };
  }

  if (intent === "delete") {
    await db.campaign.deleteMany({ where: { id, shop: session.shop } });
    return done("Campaign deleted");
  }
  if (intent === "delete-many") {
    const ids = String(formData.get("ids") ?? "").split(",").filter(Boolean);
    const { count } = await db.campaign.deleteMany({ where: { id: { in: ids }, shop: session.shop } });
    return done(`${count} campaign${count === 1 ? "" : "s"} deleted`);
  }
  if (intent === "end-now") {
    await db.campaign.updateMany({ where: { id, shop: session.shop }, data: { endAt: new Date() } });
    const result = await done("Campaign ended");
    return result.ok ? { ...result, message: "Campaign ended — badges removed from your storefront" } : result;
  }
  if (intent === "cancel-schedule") {
    await db.campaign.updateMany({ where: { id, shop: session.shop }, data: { isDraft: true } });
    return done("Campaign moved back to draft");
  }

  return null;
};

const CSS = `
.bfc-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding-bottom: 12px; }
.bfc-tabs { display: inline-flex; gap: 2px; padding: 3px; background: #F1F1F1; border-radius: 8px; flex-wrap: wrap; }
.bfc-tab { padding: 4px 10px; border-radius: 6px; font-size: 12.5px; color: #616161; text-decoration: none; white-space: nowrap; }
.bfc-tab[aria-current="page"] { background: #fff; color: #303030; font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.bfc-tools { display: flex; align-items: center; gap: 8px; flex: 1 1 260px; justify-content: flex-end; }
.bfc-tools form { flex: 0 1 240px; min-width: 160px; }
.bfc-bulk { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; margin-bottom: 8px; background: #F7F7F7; border-radius: 8px; font-size: 13px; }
.bfc-name { display: flex; align-items: center; gap: 12px; color: inherit; text-decoration: none; min-width: 0; }
.bfc-name:hover .bfc-title { color: ${BRAND}; }
.bfc-pill { display: inline-block; padding: 4px 8px; border-radius: 4px; color: #fff; font-size: 10.5px; font-weight: 700; white-space: nowrap; flex: 0 0 auto; }
.bfc-title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bfc-sub { font-size: 12px; color: #616161; }
.bfc-actions { display: inline-flex; gap: 6px; align-items: center; }
.bfc-footer { text-align: center; padding: 48px 16px 24px; }
.bfc-footer-icon { display: inline-flex; padding: 8px; border-radius: 8px; background: #F1F1F1; margin-bottom: 8px; }
@media (max-width: 760px) {
  .bfc-hide-sm { display: none; }
  .bfc-tools { justify-content: flex-start; }
  .bfc-tools form { flex: 1 1 auto; }
}
`;

export default function Campaigns() {
  const { campaigns, counts, totals, q, statusFilter, sort, embedConfirmed, freePlan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const submit = useSubmit();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useActionToast(actionData);
  useQueryToast(campaignToasts(embedConfirmed));

  // Drop selections that no longer exist (after a delete or a filter change).
  const visibleSelected = [...selected].filter((id) => campaigns.some((c) => c.id === id));
  const allChecked = campaigns.length > 0 && visibleSelected.length === campaigns.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `/app/campaigns?${qs}` : "/app/campaigns";
  }

  const tabs: { key: CampaignStatus | "all"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "live", label: "Live" },
    { key: "scheduled", label: "Scheduled" },
    // Drafts only get a tab when there are some — they're always under All.
    ...(counts.draft > 0 || statusFilter === "draft" ? [{ key: "draft" as const, label: "Draft" }] : []),
    { key: "ended", label: "Ended" },
  ];

  const subheading = `${totals.all} campaign${totals.all === 1 ? "" : "s"} · ${totals.live} showing on your storefront right now`;

  return (
    <s-page heading="Campaigns" inlineSize="large">
      <style>{CSS}</style>
      <s-button slot="primary-action" variant="primary" icon="plus" href="/app/campaigns/new">
        Create campaign
      </s-button>
      <div className="bfc-sub" style={{ fontSize: 13, marginBottom: 12 }}>
        {subheading}
        {freePlan && totals.all > 1 ? " · Free shows one campaign at a time; others queue" : ""}
      </div>

      <s-section padding="base">
        {totals.all === 0 ? (
          <s-empty-state heading="No campaigns yet">
            <s-paragraph>Create your first campaign to put a badge on your products.</s-paragraph>
            <s-button href="/app/campaigns/new">Create campaign</s-button>
          </s-empty-state>
        ) : (
          <>
            <div className="bfc-toolbar">
              <nav className="bfc-tabs" aria-label="Filter campaigns by status">
                {tabs.map((t) => (
                  <Link
                    key={t.key}
                    className="bfc-tab"
                    to={hrefWith({ status: t.key === "all" ? null : t.key })}
                    aria-current={statusFilter === t.key ? "page" : undefined}
                  >
                    {t.label} {counts[t.key]}
                  </Link>
                ))}
              </nav>
              <div className="bfc-tools">
                <Form method="get">
                  {statusFilter !== "all" && <input type="hidden" name="status" value={statusFilter} />}
                  {sort !== "newest" && <input type="hidden" name="sort" value={sort} />}
                  <s-search-field
                    label="Search campaigns"
                    labelAccessibilityVisibility="exclusive"
                    name="q"
                    value={q}
                    placeholder="Search by badge or product"
                  />
                </Form>
                <s-button icon="sort" accessibilityLabel="Sort campaigns" command="--toggle" commandFor="bfc-sort-menu" />
                <s-menu id="bfc-sort-menu" accessibilityLabel="Sort campaigns">
                  {SORTS.map((s) => (
                    <s-button key={s.key} href={hrefWith({ sort: s.key === "newest" ? null : s.key })}>
                      {sort === s.key ? `✓ ${s.label}` : s.label}
                    </s-button>
                  ))}
                </s-menu>
              </div>
            </div>

            {visibleSelected.length > 0 && (
              <div className="bfc-bulk">
                <span>{visibleSelected.length} selected</span>
                <s-stack direction="inline" gap="small-200">
                  <s-button variant="tertiary" onClick={() => setSelected(new Set())}>Clear</s-button>
                  <s-button tone="critical" command="--show" commandFor="bfc-bulk-delete">Delete</s-button>
                </s-stack>
                <s-modal id="bfc-bulk-delete" heading={`Delete ${visibleSelected.length} campaign${visibleSelected.length === 1 ? "" : "s"}?`}>
                  <s-paragraph>Their badges disappear from your storefront. This can&apos;t be undone.</s-paragraph>
                  <s-button
                    slot="primary-action"
                    tone="critical"
                    variant="primary"
                    onClick={() => {
                      submit({ intent: "delete-many", ids: visibleSelected.join(",") }, { method: "post" });
                      setSelected(new Set());
                    }}
                  >
                    Delete
                  </s-button>
                  <s-button slot="secondary-actions" command="--hide" commandFor="bfc-bulk-delete">Cancel</s-button>
                </s-modal>
              </div>
            )}

            {campaigns.length === 0 ? (
              <div className="bfc-footer">
                <s-text fontWeight="bold">No campaigns match</s-text>
                <div className="bfc-sub">Try another search or status.</div>
                <s-box paddingBlockStart="base">
                  <s-button href="/app/campaigns">Clear filters</s-button>
                </s-box>
              </div>
            ) : (
              <>
                <s-table>
                  <s-table-header-row>
                    <s-table-header>
                      <s-checkbox
                        accessibilityLabel="Select all campaigns"
                        checked={allChecked}
                        onChange={() => setSelected(allChecked ? new Set() : new Set(campaigns.map((c) => c.id)))}
                      />
                    </s-table-header>
                    <s-table-header listSlot="primary">Badge &amp; campaign</s-table-header>
                    <s-table-header listSlot="labeled">Products</s-table-header>
                    <s-table-header listSlot="labeled">Schedule</s-table-header>
                    <s-table-header listSlot="secondary">Status</s-table-header>
                    <s-table-header format="numeric">Actions</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {campaigns.map((c) => (
                      <s-table-row key={c.id}>
                        <s-table-cell>
                          <s-checkbox
                            accessibilityLabel={`Select ${c.name}`}
                            checked={selected.has(c.id)}
                            onChange={() => toggle(c.id)}
                          />
                        </s-table-cell>
                        <s-table-cell>
                          <Link className="bfc-name" to={`/app/campaigns/${c.id}/edit`}>
                            <span className="bfc-pill" style={{ background: c.badgeColor }}>{c.badgeText}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="bfc-title" style={{ display: "block" }}>{c.name}</span>
                              <span className="bfc-sub">{c.placement}</span>
                            </span>
                          </Link>
                        </s-table-cell>
                        <s-table-cell>{c.products}</s-table-cell>
                        <s-table-cell>
                          <div>{c.scheduleStart}</div>
                          <div className="bfc-sub">{c.scheduleEnd}</div>
                        </s-table-cell>
                        <s-table-cell>
                          <s-badge tone={c.tone}>{c.statusText}</s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <span className="bfc-actions">
                            <s-button href={`/app/campaigns/storefront?id=${c.id}`}>Preview</s-button>
                            <s-button
                              icon="menu-horizontal"
                              accessibilityLabel={`More actions for ${c.name}`}
                              command="--toggle"
                              commandFor={`actions-menu-${c.id}`}
                            />
                            <s-menu id={`actions-menu-${c.id}`} accessibilityLabel="Campaign actions">
                              <s-button icon="edit" href={`/app/campaigns/${c.id}/edit`}>
                                {c.status === "draft" ? "Continue editing" : "Edit"}
                              </s-button>
                              <s-button icon="duplicate" href={`/app/campaigns/${c.id}/edit?duplicate=1`}>Duplicate</s-button>
                              {c.status === "scheduled" && (
                                <s-button icon="undo" onClick={() => submit({ intent: "cancel-schedule", id: c.id }, { method: "post" })}>
                                  Move back to draft
                                </s-button>
                              )}
                              {c.status === "live" && (
                                <s-button icon="stop-circle" command="--show" commandFor={`end-modal-${c.id}`}>End now</s-button>
                              )}
                              <s-button icon="delete" tone="critical" command="--show" commandFor={`delete-modal-${c.id}`}>
                                Delete
                              </s-button>
                            </s-menu>
                            {c.status === "live" && <EndModal campaign={{ id: c.id, badgeLabel: c.name }} />}
                            <DeleteModal id={c.id} name={c.name} />
                          </span>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>

                <div className="bfc-footer">
                  <span className="bfc-footer-icon"><s-icon type="discount" /></span>
                  <div><s-text fontWeight="bold">That&apos;s every campaign</s-text></div>
                  <div className="bfc-sub">Ended campaigns stay here so you can duplicate them next season.</div>
                </div>
              </>
            )}
          </>
        )}
      </s-section>
    </s-page>
  );
}

function DeleteModal({ id, name }: { id: string; name: string }) {
  const modalId = `delete-modal-${id}`;
  const submit = useSubmit();
  return (
    <s-modal id={modalId} heading="Delete campaign?">
      <s-paragraph>
        Delete <b>{name}</b>? This can&apos;t be undone.
      </s-paragraph>
      <s-button
        slot="primary-action"
        tone="critical"
        variant="primary"
        onClick={() => submit({ intent: "delete", id }, { method: "post" })}
      >
        Delete
      </s-button>
      <s-button slot="secondary-actions" command="--hide" commandFor={modalId}>Cancel</s-button>
    </s-modal>
  );
}

function EndModal({ campaign }: { campaign: { id: string; badgeLabel: string } }) {
  const modalId = `end-modal-${campaign.id}`;
  const submit = useSubmit();
  return (
    <s-modal id={modalId} heading="End this campaign now?">
      <s-paragraph>
        Ending <b>{campaign.badgeLabel}</b> now removes its badges from your storefront immediately —
        shoppers stop seeing them right away.
      </s-paragraph>
      <s-button
        slot="primary-action"
        tone="critical"
        variant="primary"
        onClick={() => submit({ intent: "end-now", id: campaign.id }, { method: "post" })}
      >
        End campaign
      </s-button>
      <s-button slot="secondary-actions" command="--hide" commandFor={modalId}>Cancel</s-button>
    </s-modal>
  );
}
