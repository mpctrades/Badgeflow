import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { fetchPreviewProducts } from "../lib/shopify-catalog.server";
import type { CallbackEvent } from "@shopify/polaris-types";

const EXAMPLES = [
  { chip: "Weekend sale", text: "Badge my 20 best sellers with a -25% sale badge, running this weekend." },
  { chip: "New arrivals", text: "Put a NEW badge on anything added in the last 2 weeks." },
  { chip: "Low-stock collection", text: "Add a LOW STOCK badge to my Autumn collection." },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const products = await fetchPreviewProducts(admin, 1);
  return { previewProduct: products[0] ?? null };
};

export default function AiAssistant() {
  const { previewProduct } = useLoaderData<typeof loader>();
  const [request, setRequest] = useState("");
  const [draft, setDraft] = useState<{ text: string; color: string } | null>(null);

  function generate() {
    setDraft({ text: "SALE -25%", color: "#E33C2B" });
  }

  const draftParams = draft
    ? new URLSearchParams({
        badgeText: draft.text, badgeColor: draft.color, size: "14",
        targetType: "all", step: "review",
      })
    : null;

  return (
    <s-page heading="What would you like to promote?">
      <s-paragraph>
        Describe a campaign in plain language and the assistant drafts it — you always review and publish.
      </s-paragraph>

      <s-section>
        <s-stack direction="block" gap="base">
          <s-text-area
            label="Describe the campaign"
            labelAccessibilityVisibility="exclusive"
            value={request}
            rows={3}
            placeholder="e.g. Badge my 20 best sellers with a -25% sale badge, running this weekend."
            onChange={(e: CallbackEvent<"s-text-area">) => setRequest(e.currentTarget.value)}
          />

          <div>
            <s-text color="subdued" fontSize="small">Try an example</s-text>
            <s-box paddingBlockStart="small-100">
              <s-stack direction="inline" gap="small-200">
                {EXAMPLES.map((ex) => (
                  <s-clickable-chip key={ex.chip} onClick={() => setRequest(ex.text)}>
                    {ex.chip}
                  </s-clickable-chip>
                ))}
              </s-stack>
            </s-box>
          </div>

          <div>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-button variant="primary" onClick={generate} disabled={!request}>
                Generate sample draft
              </s-button>
              <s-badge tone="neutral">Demo mode · Sample data</s-badge>
            </s-stack>
            {!request && (
              <s-box paddingBlockStart="small-100">
                <s-text color="subdued" fontSize="small">Describe a campaign above to generate a draft.</s-text>
              </s-box>
            )}
          </div>

          {draft && (
            <div style={{ border: "1px solid #E3E2DB", borderRadius: 10, padding: 16, background: "#F6F6F5" }}>
              <s-grid gridTemplateColumns="120px 1fr" gap="base">
                <div style={{ position: "relative", aspectRatio: "1/1", background: "#F3F2ED", borderRadius: 8, overflow: "hidden" }}>
                  {previewProduct?.imageUrl && (
                    <img src={previewProduct.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  <span style={{ position: "absolute", top: "8%", left: "8%", background: draft.color, color: "#fff", fontWeight: 700, padding: "4px 8px", borderRadius: 6, fontSize: 11 }}>
                    {draft.text}
                  </span>
                </div>
                <s-stack direction="block" gap="small-100">
                  <s-text fontWeight="bold">Sample draft</s-text>
                  <s-text color="subdued" fontSize="small">
                    A red <b>{draft.text}</b> badge, applied to all products. This is a fixed sample, not generated from your exact wording — connect an AI provider in Settings for real drafts. Nothing is published until you review and confirm.
                  </s-text>
                  <s-box paddingBlockStart="small-200">
                    <s-button variant="primary" href={draftParams ? `/app/campaigns/new?${draftParams.toString()}` : undefined}>
                      Review draft
                    </s-button>
                  </s-box>
                </s-stack>
              </s-grid>
            </div>
          )}
        </s-stack>
      </s-section>

      <s-box paddingBlockStart="small-200">
        <s-text color="subdued" fontSize="small">
          AI provider not connected — sample data only. <s-link href="/app/settings">Manage in Settings →</s-link>
        </s-text>
      </s-box>
    </s-page>
  );
}
