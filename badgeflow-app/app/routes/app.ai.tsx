import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import type { CallbackEvent } from "@shopify/polaris-types";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { badgeTextColor, positionLabel } from "../lib/badges";
import { PLANS, type PlanId } from "../lib/campaign";
import { formatInZone, zonedToUtc } from "../lib/timezone";
import { fetchPreviewProducts, fetchShopInfo } from "../lib/shopify-catalog.server";
import { planHasAi, runAssistant, type AssistantResult, type ResolvedDraft } from "../lib/ai/assistant.server";
import { isProvider, PROVIDERS, type ChatMessage } from "../lib/ai/providers.server";
import { saveCampaign } from "../lib/campaign-form.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [settings, shopInfo, previewProducts] = await Promise.all([
    db.shopSettings.upsert({ where: { shop: session.shop }, update: {}, create: { shop: session.shop } }),
    fetchShopInfo(admin),
    fetchPreviewProducts(admin, 1),
  ]);
  const plan = (settings.plan in PLANS ? settings.plan : "free") as PlanId;
  return {
    hasPlan: planHasAi(plan),
    connected: !!settings.aiKeyCipher,
    providerLabel: isProvider(settings.aiProvider) ? PROVIDERS[settings.aiProvider].label : null,
    model: settings.aiModel,
    timezone: shopInfo.ianaTimezone,
    previewImage: previewProducts[0]?.imageUrl ?? null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-draft") {
    let draft: ResolvedDraft;
    try {
      draft = JSON.parse(String(formData.get("draft") ?? ""));
    } catch {
      return { ok: false, error: "That draft couldn't be read. Ask the assistant again." } satisfies AssistantResult;
    }
    // Saved through the same validation as the campaign builder, as a draft.
    const fd = new FormData();
    fd.set("intent", "draft");
    fd.set("campaignName", draft.name ?? "");
    fd.set("badgeText", draft.badgeText ?? "");
    fd.set("badgeColor", draft.badgeColor ?? "");
    fd.set("position", draft.position ?? "top-left");
    fd.set("size", String(draft.size ?? 12));
    fd.set("mobilePosition", draft.position ?? "top-left");
    fd.set("mobileSize", String(draft.size ?? 12));
    fd.set("targetType", draft.targetType ?? "all");
    fd.set("targetRef", draft.targetRef ?? "");
    fd.set("targetLabel", draft.targetLabel ?? "");
    fd.set("startMode", draft.startNow ? "now" : "date");
    fd.set("startDate", draft.startDate ?? "");
    fd.set("startTime", draft.startTime ?? "00:00");
    fd.set("hasEnd", draft.hasEnd ? "1" : "0");
    fd.set("endDate", draft.endDate ?? "");
    fd.set("endTime", draft.endTime ?? "23:59");
    const result = await saveCampaign({ admin, shop: session.shop, formData: fd, editingId: null, openDraftInEditor: true });
    if (result instanceof Response) return result;
    const errors = Object.values(result.errors).filter(Boolean).join(" · ");
    return { ok: false, error: `The draft needs a fix before it can be saved: ${errors}` } satisfies AssistantResult;
  }

  let history: ChatMessage[] = [];
  try {
    const parsed = JSON.parse(String(formData.get("history") ?? "[]"));
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    // Treated as an empty conversation below.
  }
  // Give the assistant the draft being refined, so "make it orange" works.
  const current = String(formData.get("currentDraft") ?? "");
  if (current && history.length && history[history.length - 1]!.role === "user") {
    const last = history[history.length - 1]!;
    history = [...history.slice(0, -1), { role: "user", content: `${last.content}\n\nCurrent draft: ${current.slice(0, 3000)}` }];
  }
  return runAssistant(admin, session.shop, history);
};

const EXAMPLES = [
  "Black Friday badge, -25%, on my Winter collection from Nov 27 to Nov 30",
  "Put a NEW badge on products added in the last 14 days, for 30 days",
  "Gold holiday badge on everything tagged gift, starting next Monday",
];

// The draft as the assistant should see it: how the target was chosen, not
// the resolved list of product ids.
function compactDraft(d: ResolvedDraft): string {
  return JSON.stringify({
    name: d.name, badgeText: d.badgeText, badgeColor: d.badgeColor, position: d.position, size: d.size,
    targetType: d.targetType, collectionId: d.collectionId, productSearch: d.productSearch,
    startNow: d.startNow, startDate: d.startDate, startTime: d.startTime,
    endDate: d.hasEnd ? d.endDate : null, endTime: d.hasEnd ? d.endTime : null,
  });
}

function overlay(position: string, size: number, color: string): React.CSSProperties {
  return {
    position: "absolute",
    ...(position.startsWith("top") ? { top: "6%" } : {}),
    ...(position.startsWith("bottom") ? { bottom: "6%" } : {}),
    ...(position.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
    ...(position.endsWith("left") ? { left: "6%" } : {}),
    ...(position.endsWith("right") ? { right: "6%" } : {}),
    ...(position.endsWith("center") ? { left: "50%", transform: position.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" } : {}),
    background: color, color: badgeTextColor(color), fontWeight: 700, padding: "3px 7px", borderRadius: 4,
    fontSize: 6 + size / 2, whiteSpace: "nowrap",
  };
}

export default function AiAssistant() {
  const { hasPlan, connected, providerLabel, model, timezone, previewImage } = useLoaderData<typeof loader>();
  const ask = useFetcher<typeof action>();
  const save = useFetcher<typeof action>();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<ResolvedDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const thinking = ask.state !== "idle";
  const saving = save.state !== "idle";

  // Fold each assistant answer into the conversation.
  useEffect(() => {
    const data = ask.data;
    if (!data || ask.state !== "idle") return;
    if ("error" in data && !data.ok) {
      setError(data.error);
      return;
    }
    if (data.ok) {
      setError(null);
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.draft) setDraft(data.draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.data, ask.state]);

  useEffect(() => {
    const data = save.data;
    if (data && save.state === "idle" && "error" in data && !data.ok) setError(data.error);
  }, [save.data, save.state]);

  function send(text: string) {
    const content = text.trim();
    if (!content || thinking) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setError(null);
    ask.submit(
      { intent: "ask", history: JSON.stringify(next), currentDraft: draft ? compactDraft(draft) : "" },
      { method: "post" },
    );
  }

  function startOver() {
    setMessages([]);
    setDraft(null);
    setError(null);
  }

  const start = draft && !draft.startNow ? zonedToUtc(draft.startDate, draft.startTime, timezone) : null;
  const end = draft?.hasEnd ? zonedToUtc(draft.endDate, draft.endTime, timezone) : null;

  if (!hasPlan) {
    return (
      <s-page heading="AI assistant">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Describe a campaign in plain words and the assistant drafts it for you — badge, products and dates — using
              your own Claude or OpenAI key. It&apos;s included with Premium and Unlimited.
            </s-paragraph>
            <div><s-button variant="primary" href="/app/plan">See plans</s-button></div>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  if (!connected) {
    return (
      <s-page heading="AI assistant">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Connect your own Claude or OpenAI key to start. You pay your provider directly for what you use — usually a
              few cents per campaign — and BadgeFlow adds no AI charges.
            </s-paragraph>
            <div><s-button variant="primary" href="/app/settings#ai">Connect your AI key</s-button></div>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="AI assistant" inlineSize="large">
      <s-button slot="secondary-actions" onClick={startOver} disabled={thinking || saving}>Start over</s-button>
      <s-stack direction="block" gap="base">
        <s-text color="subdued">
          Using {providerLabel} · {model}. The assistant only drafts — nothing reaches your storefront until you publish.
        </s-text>
        {error && (
          <s-banner tone="critical" dismissible onDismiss={() => setError(null)}>
            {error} {/key|Settings/.test(error) && <s-link href="/app/settings#ai">Open AI settings</s-link>}
          </s-banner>
        )}

        <s-grid gridTemplateColumns="minmax(0, 3fr) minmax(0, 2fr)" gap="base">
          <s-section heading="Describe your campaign">
            <s-stack direction="block" gap="base">
              {messages.length === 0 && (
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued" fontSize="small">Try one of these, or write your own:</s-text>
                  <s-stack direction="inline" gap="small-200">
                    {EXAMPLES.map((e) => (
                      <s-clickable-chip key={e} onClick={() => setInput(e)}>{e}</s-clickable-chip>
                    ))}
                  </s-stack>
                </s-stack>
              )}
              {messages.map((m, i) => (
                <s-box
                  key={i}
                  padding="small-200"
                  borderRadius="base"
                  background={m.role === "user" ? "subdued" : "transparent"}
                  border={m.role === "assistant" ? "base" : "none"}
                >
                  <s-text fontWeight="bold" fontSize="small">{m.role === "user" ? "You" : "Assistant"}</s-text>
                  <s-paragraph>{m.content}</s-paragraph>
                </s-box>
              ))}
              {thinking && <s-stack direction="inline" gap="small-200" alignItems="center"><s-spinner size="base" /><s-text color="subdued">Drafting…</s-text></s-stack>}
              <s-text-area
                label="Your request"
                labelAccessibilityVisibility="exclusive"
                placeholder={draft ? "Adjust it, e.g. “make it orange and end on Sunday”" : "e.g. “Chuseok badge on my Gift Sets collection, Sep 20 to Oct 6”"}
                value={input}
                rows={3}
                maxLength={2000}
                onInput={(e: CallbackEvent<"s-text-area">) => setInput(e.currentTarget.value)}
                onChange={(e: CallbackEvent<"s-text-area">) => setInput(e.currentTarget.value)}
              />
              <div>
                <s-button variant="primary" onClick={() => send(input)} loading={thinking} disabled={!input.trim() || thinking}>
                  {draft ? "Update draft" : "Draft campaign"}
                </s-button>
              </div>
            </s-stack>
          </s-section>

          <s-section heading="Draft">
            {!draft ? (
              <s-paragraph color="subdued">Your draft appears here. You can keep chatting to change it.</s-paragraph>
            ) : (
              <s-stack direction="block" gap="base">
                <div style={{ position: "relative", aspectRatio: "4/3", borderRadius: 8, overflow: "hidden", background: "#F1F1F1", border: "1px solid #E3E3E3" }}>
                  {previewImage && <img src={previewImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                  <span style={overlay(draft.position, draft.size, draft.badgeColor)}>{draft.badgeText}</span>
                </div>
                <s-stack direction="block" gap="small-100">
                  <s-text fontWeight="bold">{draft.name || draft.badgeText}</s-text>
                  <s-text>Products: {draft.targetLabel}</s-text>
                  {draft.sampleTitles.length > 0 && (
                    <s-text color="subdued" fontSize="small">
                      {draft.sampleTitles.join(", ")}
                      {draft.targetCount && draft.targetCount > draft.sampleTitles.length ? ` and ${draft.targetCount - draft.sampleTitles.length} more` : ""}
                    </s-text>
                  )}
                  <s-text>Starts: {draft.startNow ? "when you publish" : start ? formatInZone(start, timezone) : draft.startDate}</s-text>
                  <s-text>Ends: {draft.hasEnd && end ? formatInZone(end, timezone) : "no end date"}</s-text>
                  <s-text color="subdued" fontSize="small">{positionLabel(draft.position)} · {draft.size}% · times in {timezone}</s-text>
                </s-stack>
                {draft.warning && <s-banner tone="warning">{draft.warning}</s-banner>}
                <s-stack direction="inline" gap="small-200">
                  <s-button
                    variant="primary"
                    loading={saving}
                    disabled={thinking || saving}
                    onClick={() => save.submit({ intent: "save-draft", draft: JSON.stringify(draft) }, { method: "post" })}
                  >
                    Save draft and review
                  </s-button>
                </s-stack>
                <s-text color="subdued" fontSize="small">
                  Saves it as a draft and opens it in the campaign builder, where you check everything and publish.
                </s-text>
              </s-stack>
            )}
          </s-section>
        </s-grid>
      </s-stack>
    </s-page>
  );
}
