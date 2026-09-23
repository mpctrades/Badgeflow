import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { positionLabel } from "../lib/badges";
import { useActionToast } from "../lib/use-toast";
import type { CallbackEvent } from "@shopify/polaris-types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await db.shopSettings.upsert({
    where: { shop: session.shop },
    update: {},
    create: { shop: session.shop },
  });
  return { settings };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const data = {
    appEnabled: formData.get("appEnabled") === "on",
    defaultColor: String(formData.get("defaultColor") ?? "#E33C2B"),
    defaultPosition: String(formData.get("defaultPosition") ?? "top-left"),
    defaultSize: Number(formData.get("defaultSize") ?? 12),
  };

  await db.shopSettings.upsert({
    where: { shop: session.shop },
    update: data,
    create: { shop: session.shop, ...data },
  });

  return { ok: true, saved: true, savedAt: Date.now(), message: "Settings saved" };
};

const POSITION_OPTIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export default function Settings() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  useActionToast(actionData);

  const [appEnabled, setAppEnabled] = useState(settings.appEnabled);
  const [defaultPosition, setDefaultPosition] = useState(settings.defaultPosition);
  const [defaultSize, setDefaultSize] = useState(settings.defaultSize);

  const dirty =
    appEnabled !== settings.appEnabled ||
    defaultPosition !== settings.defaultPosition ||
    defaultSize !== settings.defaultSize;

  const swatchStyle: React.CSSProperties = {
    position: "absolute",
    ...(defaultPosition.startsWith("top") ? { top: "8%" } : { bottom: "8%" }),
    ...(defaultPosition.endsWith("left") ? { left: "8%" } : { right: "8%" }),
    background: settings.defaultColor, color: "#fff", fontWeight: 700,
    padding: "3px 6px", borderRadius: 5, fontSize: 7 + defaultSize / 2, whiteSpace: "nowrap",
  };

  return (
    <s-page heading="Settings">
      <s-paragraph>Control how BadgeFlow behaves, store-wide.</s-paragraph>

      {actionData?.saved && !dirty && (
        <s-section>
          <s-badge tone="success">Changes saved</s-badge>
        </s-section>
      )}
      {dirty && (
        <s-section>
          <s-badge tone="warning">You have unsaved changes</s-badge>
        </s-section>
      )}

      <Form method="post">
        <s-stack direction="block" gap="base">
          <s-section heading="Storefront visibility">
            <s-switch
              label="Show badges on storefront"
              name="appEnabled"
              checked={appEnabled}
              onChange={(e: CallbackEvent<"s-switch">) => setAppEnabled(Boolean(e.currentTarget.checked))}
            />
            <s-box paddingBlockStart="small-200">
              <s-text color="subdued" fontSize="small">
                Turning this off removes every badge from your storefront immediately. Campaigns and their
                settings are kept, nothing is deleted. Saves when you click Save changes below.
              </s-text>
            </s-box>
            <s-box paddingBlockStart="base">
              <s-text color="subdued" fontSize="small">
                This is separate from your theme embed connection.{" "}
                <s-link href="/app/setup">Manage theme embed and setup →</s-link>
              </s-text>
            </s-box>
          </s-section>

          <s-section heading="Badge defaults">
            <s-paragraph>Used to pre-fill new campaigns — editing here doesn&apos;t change campaigns you&apos;ve already created.</s-paragraph>
            <s-grid gridTemplateColumns="100px 1fr" gap="base">
              <div style={{ position: "relative", aspectRatio: "1/1", background: "#F3F2ED", borderRadius: 8, overflow: "hidden" }}>
                <span style={swatchStyle}>Preview</span>
              </div>
              <s-stack direction="block" gap="base">
                <s-select
                  label="Default position"
                  name="defaultPosition"
                  value={defaultPosition}
                  onChange={(e: CallbackEvent<"s-select">) => setDefaultPosition(e.currentTarget.value)}
                >
                  {POSITION_OPTIONS.map((p) => (
                    <s-option key={p} value={p}>{positionLabel(p)}</s-option>
                  ))}
                </s-select>
                <s-number-field
                  label="Default size (% of image width)"
                  name="defaultSize"
                  value={String(defaultSize)}
                  onChange={(e: CallbackEvent<"s-number-field">) => setDefaultSize(Number(e.currentTarget.value) || 12)}
                  min={8}
                  max={24}
                />
              </s-stack>
            </s-grid>
            <input type="hidden" name="defaultColor" value={settings.defaultColor} />
          </s-section>

          <s-section heading="AI connections">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
              <s-text color="subdued" fontSize="small">
                Connect your own Claude or OpenAI key so the AI assistant can build real drafts.
              </s-text>
              <s-badge tone="neutral">Coming soon</s-badge>
            </s-stack>
            <s-box paddingBlockStart="small-200">
              <s-button href="/app/ai" variant="secondary">Try the AI assistant preview</s-button>
            </s-box>
          </s-section>

          <s-stack direction="inline" justifyContent="end">
            <s-button type="submit" variant="primary" loading={busy}>
              Save changes
            </s-button>
          </s-stack>
        </s-stack>
      </Form>
    </s-page>
  );
}
