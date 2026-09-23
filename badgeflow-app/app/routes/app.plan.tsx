import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { BRAND, displayStatus, PLANS, type PlanId } from "../lib/campaign";
import { fetchProductIdsForTarget } from "../lib/shopify-catalog.server";
import { useActionToast } from "../lib/use-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const [campaigns, settings] = await Promise.all([
    db.campaign.findMany({ where: { shop: session.shop } }),
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
  ]);

  const live = campaigns.filter((c) => displayStatus(c) === "live");

  // Real metering: union of distinct product IDs across live campaigns, so a
  // product in two campaigns still counts once.
  const idSets = await Promise.all(live.map((c) => fetchProductIdsForTarget(admin, c)));
  const badgedProductIds = new Set(idSets.flat());
  const overlapExists = idSets.reduce((sum, s) => sum + s.length, 0) > badgedProductIds.size;

  return {
    liveCampaignCount: live.length,
    badgedProductCount: badgedProductIds.size,
    overlapExists,
    plan: settings.plan as PlanId,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = String(formData.get("plan") ?? "free");

  await db.shopSettings.upsert({
    where: { shop: session.shop },
    update: { plan },
    create: { shop: session.shop, plan },
  });

  return { ok: true, message: `Switched to ${PLANS[plan as PlanId]?.label ?? plan} (simulated)` };
};

export default function Plan() {
  const { liveCampaignCount, badgedProductCount, overlapExists, plan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  useActionToast(actionData);
  const limit = PLANS[plan].limit;

  return (
    <s-page heading="Plan & billing">
      <s-section>
        <s-text fontWeight="bold">
          {badgedProductCount} of {limit === Infinity ? "unlimited" : limit} products currently have badges
        </s-text>
        <s-box paddingBlockStart="small-100">
          <s-progress
            value={Math.min(badgedProductCount, limit === Infinity ? badgedProductCount : limit)}
            max={limit === Infinity ? Math.max(badgedProductCount, 1) : limit}
            tone={badgedProductCount > limit ? "critical" : "info"}
            accessibilityLabel="Products currently badged"
          />
        </s-box>
        <s-box paddingBlockStart="small-100">
          <s-text color="subdued" fontSize="small">
            {liveCampaignCount} live campaign{liveCampaignCount === 1 ? "" : "s"}. A product counts once even
            if it&apos;s in more than one live campaign
            {overlapExists ? " — that's already true for your current usage above." : "."}
          </s-text>
        </s-box>
      </s-section>

      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base" alignItems="stretch">
          {(Object.keys(PLANS) as PlanId[]).map((key) => {
            const p = PLANS[key];
            const isCurrent = key === plan;
            return (
              <div
                key={key}
                style={{
                  display: "flex", flexDirection: "column",
                  border: isCurrent ? `2px solid ${BRAND}` : "1px solid #E3E2DB",
                  borderRadius: 10, padding: 16,
                }}
              >
                <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                  <s-heading>{p.label}</s-heading>
                  {isCurrent && <s-badge tone="success">Current plan</s-badge>}
                </s-stack>
                <s-box paddingBlockStart="small-300" paddingBlockEnd="small-300">
                  <s-heading fontSize="large-300">{p.price}</s-heading>
                  <s-text color="subdued" fontSize="small">{p.period}</s-text>
                </s-box>
                <s-unordered-list>
                  <s-list-item>{p.limit === Infinity ? "Unlimited" : p.limit} products with badges</s-list-item>
                  <s-list-item>{p.liveCampaignLimit === Infinity ? "Unlimited live campaigns" : `${p.liveCampaignLimit} live campaign at a time`}</s-list-item>
                  <s-list-item>Scheduling included</s-list-item>
                  <s-list-item>{key === "free" ? "Full badge library" : "Multi-badge and priority rules"}</s-list-item>
                  <s-list-item>{key === "free" ? "Community support" : "Your own AI key and MCP — Coming soon"}</s-list-item>
                </s-unordered-list>
                <div style={{ marginTop: "auto", paddingTop: 16 }}>
                  {isCurrent ? (
                    <s-button variant="secondary" inlineSize="fill" disabled>Current plan</s-button>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="plan" value={key} />
                      <s-button type="submit" variant="secondary" inlineSize="fill" loading={busy}>
                        Simulate {p.label}
                      </s-button>
                    </Form>
                  )}
                </div>
              </div>
            );
          })}
        </s-grid>
        <s-box paddingBlockStart="base">
          <s-text color="subdued" fontSize="small">
            Billing isn&apos;t wired up yet — &quot;Simulate&quot; changes your plan locally for testing only.
            Real Shopify Billing API charges land in a future update.
          </s-text>
        </s-box>
      </s-section>
    </s-page>
  );
}
