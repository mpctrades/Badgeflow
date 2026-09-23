import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { setupSteps } from "../lib/campaign";
import { useActionToast } from "../lib/use-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [settings, campaignCount] = await Promise.all([
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    db.campaign.count({ where: { shop: session.shop } }),
  ]);
  return { settings, campaignCount, storefrontUrl: `https://${session.shop}` };
};

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

export default function Setup() {
  const { settings, campaignCount, storefrontUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  useActionToast(actionData);
  const embedConfirmed = !!settings.embedConfirmedAt;
  const steps = setupSteps({ embedConfirmed, hasCampaign: campaignCount > 0 });
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <s-page heading="Your first badge, in minutes.">
      <s-paragraph>Three quick steps and shoppers will see your first campaign live.</s-paragraph>

      <s-section>
        <s-box paddingBlockEnd="small-200">
          <s-text color="subdued" fontSize="small">{doneCount} of {steps.length} complete</s-text>
        </s-box>
        <s-progress value={doneCount} max={steps.length} tone="success" accessibilityLabel="Setup progress" />
      </s-section>

      {allDone ? (
        <s-section heading="Your store is ready">
          <s-paragraph>Every setup step is done — badges can now appear on your storefront.</s-paragraph>
          <s-box paddingBlockStart="base">
            <s-stack direction="inline" gap="small-200">
              <s-button href={storefrontUrl} target="_blank" variant="primary">View storefront</s-button>
              <s-button href="/app/campaigns/new" variant="secondary">Create campaign</s-button>
            </s-stack>
          </s-box>
          <s-box paddingBlockStart="base">
            <details>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: "#6B7177" }}>Setup details</summary>
              <s-box paddingBlockStart="small-200">
                <s-stack direction="block" gap="small-200">
                  {steps.map((step) => (
                    <s-stack key={step.key} direction="inline" gap="small-200" alignItems="center">
                      <s-badge tone="success">✓</s-badge>
                      <s-text color="subdued">{step.label}</s-text>
                    </s-stack>
                  ))}
                </s-stack>
              </s-box>
            </details>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          <s-stack direction="block" gap="base">
            {steps.map((step) => {
              if (step.done) {
                return (
                  <s-stack key={step.key} direction="inline" gap="small-200" alignItems="center">
                    <s-badge tone="success">✓</s-badge>
                    <s-text color="subdued">{step.label}</s-text>
                  </s-stack>
                );
              }
              return (
                <div key={step.key} style={{ border: "1px solid #E3E2DB", borderRadius: 10, padding: 14 }}>
                  <s-stack direction="inline" gap="small-200" alignItems="start">
                    <s-badge tone="neutral">→</s-badge>
                    <s-stack direction="block" gap="small-100">
                      <s-text fontWeight="bold">{step.label}</s-text>
                      <s-text color="subdued" fontSize="small">{step.description}</s-text>
                      {step.key === "embed" ? (
                        <s-box paddingBlockStart="small-200">
                          <s-stack direction="inline" gap="small-200">
                            <s-button href="shopify:admin/themes/current/editor" variant="secondary">
                              Open theme editor
                            </s-button>
                            <Form method="post">
                              <input type="hidden" name="intent" value="confirm-embed" />
                              <s-button type="submit" variant="primary" loading={busy}>
                                I&apos;ve enabled the embed
                              </s-button>
                            </Form>
                          </s-stack>
                          <s-box paddingBlockStart="small-100">
                            <s-text color="subdued" fontSize="small">
                              This is confirmed by you — BadgeFlow doesn&apos;t automatically verify theme embeds yet.
                            </s-text>
                          </s-box>
                        </s-box>
                      ) : (
                        <s-box paddingBlockStart="small-200">
                          <s-button href={step.href} variant="primary">
                            {step.key === "campaign" ? "Create campaign" : "Go to campaigns"}
                          </s-button>
                        </s-box>
                      )}
                    </s-stack>
                  </s-stack>
                </div>
              );
            })}
          </s-stack>
        </s-section>
      )}

      <s-section>
        <s-paragraph>
          <s-text fontWeight="bold">Free plan. </s-text>
          30 products can carry a badge, for life, with the full badge library and scheduling included. No card required.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
