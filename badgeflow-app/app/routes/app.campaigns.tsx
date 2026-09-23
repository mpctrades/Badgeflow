import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { displayStatus, formatDateRange, statusLabel, statusTone, type CampaignStatus } from "../lib/campaign";
import { fetchPreviewProducts } from "../lib/shopify-catalog.server";
import { useActionToast, useQueryToast } from "../lib/use-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const statusFilter = url.searchParams.get("status") ?? "all";

  const [campaigns, previewProducts] = await Promise.all([
    db.campaign.findMany({
      where: {
        shop: session.shop,
        ...(q ? { OR: [{ badgeText: { contains: q } }, { badgeLabel: { contains: q } }, { targetValue: { contains: q } }] } : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    fetchPreviewProducts(admin, 1),
  ]);

  const withStatus = campaigns.map((c) => ({ ...c, computedStatus: displayStatus(c) }));

  const counts: Record<CampaignStatus | "all", number> = {
    all: withStatus.length,
    draft: withStatus.filter((c) => c.computedStatus === "draft").length,
    live: withStatus.filter((c) => c.computedStatus === "live").length,
    scheduled: withStatus.filter((c) => c.computedStatus === "scheduled").length,
    ended: withStatus.filter((c) => c.computedStatus === "ended").length,
  };

  const filtered = statusFilter === "all" ? withStatus : withStatus.filter((c) => c.computedStatus === statusFilter);

  return { campaigns: filtered, counts, q, statusFilter, previewProduct: previewProducts[0] ?? null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = String(formData.get("id"));

  if (intent === "delete") {
    await db.campaign.deleteMany({ where: { id, shop: session.shop } });
    return { ok: true, message: "Campaign deleted" };
  }
  if (intent === "end-now") {
    await db.campaign.updateMany({ where: { id, shop: session.shop }, data: { endAt: new Date() } });
    return { ok: true, message: "Campaign ended — badges removed from your storefront" };
  }
  if (intent === "cancel-schedule") {
    await db.campaign.updateMany({ where: { id, shop: session.shop }, data: { isDraft: true } });
    return { ok: true, message: "Campaign moved back to draft" };
  }

  return null;
};

const FILTERS: { key: CampaignStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "scheduled", label: "Scheduled" },
  { key: "draft", label: "Draft" },
  { key: "ended", label: "Ended" },
];

// Splits "Autumn Essentials — 42 products" into a truncatable name and a
// count suffix that should never be cut off.
function splitTarget(value: string): { name: string; suffix: string } {
  const idx = value.lastIndexOf(" — ");
  if (idx === -1) return { name: value, suffix: "" };
  return { name: value.slice(0, idx), suffix: value.slice(idx) };
}

export default function Campaigns() {
  const { campaigns, counts, q, statusFilter, previewProduct } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  useActionToast(actionData);
  useQueryToast({
    "draft-saved": "Draft saved",
    published: "Campaign published — badges are live",
    scheduled: "Campaign scheduled",
  });

  function filterHref(status: string) {
    const params = new URLSearchParams(searchParams);
    if (status === "all") params.delete("status");
    else params.set("status", status);
    return `/app/campaigns?${params.toString()}`;
  }

  return (
    <s-page heading="Campaigns">
      <s-button slot="primary-action" variant="primary" href="/app/campaigns/new">
        Create campaign
      </s-button>

      <s-section>
        <div style={{ background: "#EFEDFB", borderRadius: 10, padding: "12px 16px", border: "1px solid #DAD6F5", marginBottom: 16 }}>
          <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
            <div>
              <s-text fontWeight="bold">Let AI draft it for you</s-text>
              <s-box><s-text color="subdued" fontSize="small">Describe the campaign in plain language and review the draft before it goes live.</s-text></s-box>
            </div>
            <s-button href="/app/ai" variant="secondary">Open AI assistant</s-button>
          </s-stack>
        </div>

        <s-stack direction="inline" gap="small-200">
          {FILTERS.map((f) => (
            <s-clickable-chip key={f.key} href={filterHref(f.key)} color={statusFilter === f.key ? "strong" : "subdued"}>
              {f.label} ({counts[f.key]})
            </s-clickable-chip>
          ))}
        </s-stack>

        <s-box paddingBlockStart="small-300" paddingBlockEnd="base">
          <Form method="get">
            <s-search-field label="Search campaigns" labelAccessibilityVisibility="exclusive" name="q" value={q} placeholder="Search campaigns…" />
          </Form>
        </s-box>

        {campaigns.length === 0 ? (
          <s-empty-state heading="No campaigns yet">
            <s-paragraph>Create your first campaign to put a badge on your products.</s-paragraph>
            <s-button href="/app/campaigns/new">Create campaign</s-button>
          </s-empty-state>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Campaign</s-table-header>
              <s-table-header>Products</s-table-header>
              <s-table-header>Schedule</s-table-header>
              <s-table-header listSlot="secondary">Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((c) => {
                const target = splitTarget(c.targetValue);
                return (
                  <s-table-row key={c.id}>
                    <s-table-cell>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <div style={{ position: "relative", width: 32, height: 32, borderRadius: 6, overflow: "hidden", background: "#F3F2ED", flex: "0 0 auto", border: "1px solid #E3E2DB" }}>
                          {previewProduct?.imageUrl && (
                            <img src={previewProduct.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          )}
                          <span
                            style={{
                              position: "absolute", top: 2, left: 2, background: c.badgeColor, color: "#fff",
                              fontSize: 6.5, fontWeight: 700, padding: "1px 3px", borderRadius: 3, lineHeight: 1.2,
                            }}
                          >
                            {c.badgeText}
                          </span>
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <s-link href={`/app/campaigns/${c.id}/edit`}>
                            <span style={{ fontWeight: 700, fontSize: 13.5, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
                              {c.badgeLabel}
                            </span>
                          </s-link>
                          <span style={{ fontSize: 11.5, color: "#6B7177" }}>Badge: {c.badgeText}</span>
                        </div>
                      </div>
                    </s-table-cell>
                    <s-table-cell>
                      <span style={{ fontSize: 12.5, color: "#6B7177" }}>
                        <span style={{ display: "inline-block", maxWidth: 130, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "bottom" }}>
                          {target.name}
                        </span>
                        {target.suffix}
                      </span>
                    </s-table-cell>
                    <s-table-cell>
                      <span style={{ fontSize: 12.5, color: "#6B7177", whiteSpace: "nowrap" }}>
                        {formatDateRange(new Date(c.startAt), c.endAt ? new Date(c.endAt) : null)}
                      </span>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(c.computedStatus)}>{statusLabel(c.computedStatus)}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        {c.computedStatus === "draft" && (
                          <s-button href={`/app/campaigns/${c.id}/edit`} variant="tertiary">Continue editing</s-button>
                        )}
                        {c.computedStatus === "scheduled" && (
                          <>
                            <s-button href={`/app/campaigns/${c.id}/edit`} variant="tertiary">Edit</s-button>
                            <Form method="post">
                              <input type="hidden" name="intent" value="cancel-schedule" />
                              <input type="hidden" name="id" value={c.id} />
                              <s-button type="submit" variant="tertiary">Cancel</s-button>
                            </Form>
                          </>
                        )}
                        {c.computedStatus === "live" && (
                          <>
                            <s-button href={`/app/campaigns/storefront?id=${c.id}`} variant="tertiary">Preview</s-button>
                            <s-button variant="tertiary" command="--show" commandFor={`end-modal-${c.id}`}>End</s-button>
                            <EndModal campaign={c} />
                          </>
                        )}
                        {c.computedStatus === "ended" && (
                          <s-button href={`/app/campaigns/${c.id}/edit?duplicate=1`} variant="tertiary">Duplicate</s-button>
                        )}
                        <s-button
                          variant="tertiary"
                          accessibilityLabel="More actions"
                          command="--toggle"
                          commandFor={`actions-menu-${c.id}`}
                        >
                          ⋯
                        </s-button>
                        <s-menu id={`actions-menu-${c.id}`} accessibilityLabel="Campaign actions">
                          <s-button tone="critical" command="--show" commandFor={`delete-modal-${c.id}`}>
                            Delete
                          </s-button>
                        </s-menu>
                        <DeleteModal id={c.id} name={c.badgeLabel} />
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
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
