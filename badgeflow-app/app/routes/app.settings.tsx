import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useActionData, useFetcher, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { BADGE_PRESETS, POSITIONS, badgeTextColor, positionLabel } from "../lib/badges";
import { BRAND } from "../lib/campaign";
import { fetchPreviewProducts, formatPrice } from "../lib/shopify-catalog.server";
import { useEmbedStatus } from "../lib/use-embed-status";
import { useActionToast } from "../lib/use-toast";
import type { CallbackEvent } from "@shopify/polaris-types";
import { syncStorefront } from "../lib/storefront-sync.server";
import { decryptSecret, encryptSecret } from "../lib/ai/crypto.server";
import { AiError, testConnection } from "../lib/ai/providers.server";
import { defaultModel, isProvider, PROVIDERS, type AiProvider } from "../lib/ai/providers";
import { planHasAi } from "../lib/ai/assistant.server";

const SAVE_BAR_ID = "bf-settings-save-bar";
const MIN_SIZE = 8;
const MAX_SIZE = 24;
const COLORS = [...new Set(BADGE_PRESETS.map((p) => p.color))];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [settings, previewProducts] = await Promise.all([
    db.shopSettings.upsert({
      where: { shop: session.shop },
      update: {},
      create: { shop: session.shop },
    }),
    fetchPreviewProducts(admin, 1),
  ]);
  const product = previewProducts[0] ?? null;
  const price = product ? formatPrice(product.price, product.currency) : null;
  return {
    settings,
    // Stacking several badges on one product is a Premium feature.
    canStack: settings.plan !== "free",
    ai: {
      available: planHasAi(settings.plan),
      provider: (isProvider(settings.aiProvider) ? settings.aiProvider : "anthropic") as AiProvider,
      model: settings.aiModel,
      keyHint: settings.aiKeyHint,
      verifiedAt: settings.aiVerifiedAt ? settings.aiVerifiedAt.toISOString().slice(0, 10) : null,
    },
    previewProduct: product ? { title: product.title, imageUrl: product.imageUrl, price } : null,
  };
};

// Connect, re-test or remove the merchant's own AI key. The key is tested
// before it's stored, stored encrypted, and never sent back to the browser.
async function aiAction(shop: string, formData: FormData) {
  const intent = String(formData.get("intent"));
  const current = await db.shopSettings.upsert({ where: { shop }, update: {}, create: { shop } });

  // Removing a key always works, so a merchant who downgraded can still
  // delete the key they stored while on a paid plan.
  if (intent === "ai-remove") {
    await db.shopSettings.update({
      where: { shop },
      data: { aiProvider: null, aiModel: null, aiKeyCipher: null, aiKeyHint: null, aiVerifiedAt: null },
    });
    return { ok: true, message: "AI key removed" };
  }
  if (!planHasAi(current.plan)) return { ok: false, isError: true, message: "The AI assistant is part of Premium and Unlimited." };

  const provider = formData.get("aiProvider");
  if (!isProvider(provider)) return { ok: false, isError: true, message: "Choose an AI provider." };
  const model = String(formData.get("aiModel") ?? "");
  if (!PROVIDERS[provider].models.some((m) => m.id === model)) return { ok: false, isError: true, message: "Choose a model." };

  let apiKey = String(formData.get("aiKey") ?? "").trim();
  if (intent === "ai-test") {
    if (!current.aiKeyCipher) return { ok: false, isError: true, message: "Paste your API key first." };
    if (current.aiProvider !== provider) {
      return { ok: false, isError: true, message: `Paste a ${PROVIDERS[provider].label} key to switch provider.` };
    }
    try {
      apiKey = decryptSecret(current.aiKeyCipher);
    } catch {
      return { ok: false, isError: true, message: "Your saved key can't be read any more. Paste it again." };
    }
  } else if (apiKey.length < 20 || /\s/.test(apiKey)) {
    return { ok: false, isError: true, message: "That doesn't look like an API key. Copy it again from your provider." };
  }

  try {
    await testConnection(provider, apiKey, model);
  } catch (error) {
    if (error instanceof AiError) return { ok: false, isError: true, message: error.message };
    throw error;
  }
  await db.shopSettings.update({
    where: { shop },
    data: {
      aiProvider: provider,
      aiModel: model,
      aiVerifiedAt: new Date(),
      ...(intent === "ai-connect" ? { aiKeyCipher: encryptSecret(apiKey), aiKeyHint: apiKey.slice(-4) } : {}),
    },
  });
  return { ok: true, message: `Connected to ${PROVIDERS[provider].label}` };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  if (String(formData.get("intent") ?? "").startsWith("ai-")) return aiAction(session.shop, formData);
  const current = await db.shopSettings.findUnique({ where: { shop: session.shop } });
  const canStack = (current?.plan ?? "free") !== "free";

  const size = Number(formData.get("defaultSize") ?? 12);
  const position = String(formData.get("defaultPosition") ?? "top-left");
  const color = String(formData.get("defaultColor") ?? "");
  const data = {
    appEnabled: formData.get("appEnabled") === "on",
    defaultColor: /^#[0-9a-f]{6}$/i.test(color) ? color : "#E33C2B",
    defaultPosition: (POSITIONS as readonly string[]).includes(position) ? position : "top-left",
    defaultSize: Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size))) : 12,
    hideSoldOut: formData.get("hideSoldOut") === "on",
    oneBadgePerProduct: canStack ? formData.get("oneBadgePerProduct") === "on" : true,
    shrinkOnMobile: formData.get("shrinkOnMobile") === "on",
  };

  await db.shopSettings.upsert({
    where: { shop: session.shop },
    update: data,
    create: { shop: session.shop, ...data },
  });

  const { ok } = await syncStorefront(admin, session.shop);
  return ok
    ? { ok: true, saved: true, savedAt: Date.now(), message: "Settings saved" }
    : {
        ok: false,
        isError: true,
        saved: true,
        savedAt: Date.now(),
        message: "Settings saved, but your storefront couldn't be updated. Try saving again in a minute.",
      };
};

const CSS = `
.bfst-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.bfst-col { display: grid; gap: 16px; }
.bfst-sub { font-size: 13px; color: #616161; margin: -4px 0 16px; }
.bfst-muted { font-size: 12px; color: #616161; }
.bfst-label { font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.bfst-toggle-row { display: flex; gap: 12px; align-items: flex-start; }
.bfst-rule { padding: 12px 0; border-bottom: 1px solid #F1F1F1; }
.bfst-rule:first-child { padding-top: 4px; }
.bfst-rule:last-child { border-bottom: 0; padding-bottom: 0; }
.bfst-defaults { display: grid; grid-template-columns: 170px minmax(0, 1fr); gap: 24px; }
.bfst-posgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 8px; background: #F7F7F7; border-radius: 10px; border: 1px solid #EBEBEB; }
.bfst-pos { position: relative; aspect-ratio: 4/3; background: #fff; border: 1px solid #E3E3E3; border-radius: 6px; cursor: pointer; padding: 0; }
.bfst-pos[aria-pressed="true"] { border: 1.5px solid #303030; box-shadow: 0 0 0 1px #303030; }
.bfst-pos:focus-visible { outline: 2px solid ${BRAND}; outline-offset: 2px; }
.bfst-pos-mark { position: absolute; width: 36%; height: 12%; border-radius: 2px; background: #C9C9C9; }
.bfst-pos[aria-pressed="true"] .bfst-pos-mark { background: var(--bfst-color); }
.bfst-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.bfst-swatch { width: 28px; height: 28px; border-radius: 6px; border: 2px solid transparent; box-shadow: 0 0 0 1px #E3E3E3; cursor: pointer; padding: 0; }
.bfst-swatch[aria-pressed="true"] { border-color: #fff; box-shadow: 0 0 0 2px #303030; }
.bfst-preview { border: 1px solid #EBEBEB; border-radius: 10px; padding: 10px; background: #F7F7F7; }
.bfst-preview-card { background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #EBEBEB; }
.bfst-preview-img { position: relative; aspect-ratio: 1/1; background: #EDEDED; display: flex; align-items: center; justify-content: center; }
.bfst-divider { border-top: 1px solid #EBEBEB; margin: 16px 0; }
@media (max-width: 900px) {
  .bfst-layout { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 560px) {
  .bfst-defaults { grid-template-columns: minmax(0, 1fr); }
  .bfst-posgrid { max-width: 200px; }
}
`;

function markStyle(position: string): React.CSSProperties {
  return {
    ...(position.startsWith("top") ? { top: "14%" } : {}),
    ...(position.startsWith("bottom") ? { bottom: "14%" } : {}),
    ...(position.startsWith("middle") ? { top: "44%" } : {}),
    ...(position.endsWith("left") ? { left: "10%" } : {}),
    ...(position.endsWith("right") ? { right: "10%" } : {}),
    ...(position.endsWith("center") ? { left: "32%" } : {}),
  };
}

function badgeStyle(position: string, size: number, color: string): React.CSSProperties {
  return {
    position: "absolute",
    ...(position.startsWith("top") ? { top: "6%" } : {}),
    ...(position.startsWith("bottom") ? { bottom: "6%" } : {}),
    ...(position.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
    ...(position.endsWith("left") ? { left: "6%" } : {}),
    ...(position.endsWith("right") ? { right: "6%" } : {}),
    ...(position.endsWith("center")
      ? { left: "50%", transform: position.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" }
      : {}),
    background: color, color: badgeTextColor(color), fontWeight: 700, letterSpacing: ".02em",
    padding: "4px 8px", borderRadius: 4, fontSize: 7 + size / 2, whiteSpace: "nowrap",
  };
}

type FormState = {
  appEnabled: boolean;
  defaultColor: string;
  defaultPosition: string;
  defaultSize: number;
  hideSoldOut: boolean;
  oneBadgePerProduct: boolean;
  shrinkOnMobile: boolean;
};

export default function Settings() {
  const { settings, canStack, previewProduct, ai } = useLoaderData<typeof loader>();
  const embedOn = useEmbedStatus(!!settings.embedConfirmedAt).active;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const busy = navigation.state === "submitting";
  useActionToast(actionData);

  const saved: FormState = {
    appEnabled: settings.appEnabled,
    defaultColor: settings.defaultColor,
    defaultPosition: settings.defaultPosition,
    defaultSize: settings.defaultSize,
    hideSoldOut: settings.hideSoldOut,
    oneBadgePerProduct: settings.oneBadgePerProduct,
    shrinkOnMobile: settings.shrinkOnMobile,
  };
  const [form, setForm] = useState<FormState>(saved);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // After a save, the loader revalidates — re-sync so the bar closes. Keyed
  // on the saved values, not the object: other revalidations (the AI key
  // form, the embed check) return a fresh object and must not wipe edits.
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setForm(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const dirty = (Object.keys(saved) as (keyof FormState)[]).some((k) => form[k] !== saved[k]);

  function handleSave() {
    const fd = new FormData();
    if (form.appEnabled) fd.set("appEnabled", "on");
    fd.set("defaultColor", form.defaultColor);
    fd.set("defaultPosition", form.defaultPosition);
    fd.set("defaultSize", String(form.defaultSize));
    if (form.hideSoldOut) fd.set("hideSoldOut", "on");
    if (form.oneBadgePerProduct) fd.set("oneBadgePerProduct", "on");
    if (form.shrinkOnMobile) fd.set("shrinkOnMobile", "on");
    submit(fd, { method: "post" });
  }

  const switchValue = (e: CallbackEvent<"s-switch">) => Boolean(e.currentTarget.checked);

  return (
    <s-page heading="Settings" inlineSize="large">
      <style>{CSS}</style>
      <SaveBar id={SAVE_BAR_ID} open={dirty}>
        <button variant="primary" onClick={handleSave} disabled={busy} {...(busy ? { loading: "" } : {})}></button>
        <button onClick={() => setForm(saved)} disabled={busy}></button>
      </SaveBar>

      <div className="bfst-sub">Store-wide behaviour. Individual campaigns can always override these.</div>

      <div className="bfst-layout">
        <div className="bfst-col">
          <s-section>
            <div className="bfst-toggle-row">
              <s-switch
                label={form.appEnabled ? "BadgeFlow is on" : "BadgeFlow is off"}
                labelAccessibilityVisibility="exclusive"
                checked={form.appEnabled}
                onChange={(e: CallbackEvent<"s-switch">) => set("appEnabled", switchValue(e))}
              />
              <div>
                <s-text fontWeight="bold">{form.appEnabled ? "BadgeFlow is on" : "BadgeFlow is off"}</s-text>
                <div className="bfst-muted">
                  Turning this off hides every badge from your storefront within a few seconds. Campaigns, schedules and
                  settings are all kept.
                </div>
              </div>
            </div>
          </s-section>

          <s-section>
            <s-heading>Badge defaults</s-heading>
            <div className="bfst-muted" style={{ marginBottom: 14 }}>
              These pre-fill new campaigns. Changing them leaves existing campaigns exactly as they are.
            </div>
            <div className="bfst-defaults">
              <div>
                <div className="bfst-label">Default position</div>
                <div className="bfst-posgrid" role="group" aria-label="Default position" style={{ ["--bfst-color" as string]: form.defaultColor }}>
                  {POSITIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="bfst-pos"
                      aria-pressed={form.defaultPosition === p}
                      aria-label={positionLabel(p)}
                      title={positionLabel(p)}
                      onClick={() => set("defaultPosition", p)}
                    >
                      <span className="bfst-pos-mark" style={markStyle(p)} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <s-number-field
                  label="Default size"
                  value={String(form.defaultSize)}
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  step={1}
                  suffix="%"
                  details="Share of the product image width, so the badge stays in proportion on phones and large grids."
                  onChange={(e: CallbackEvent<"s-number-field">) => {
                    const n = Math.round(Number(e.currentTarget.value));
                    if (Number.isFinite(n)) set("defaultSize", Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)));
                  }}
                />

                <div className="bfst-label" style={{ marginTop: 18 }}>Default colour</div>
                <div className="bfst-swatches" role="group" aria-label="Default colour">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="bfst-swatch"
                      style={{ background: c }}
                      aria-pressed={form.defaultColor.toLowerCase() === c.toLowerCase()}
                      aria-label={`Colour ${c}`}
                      onClick={() => set("defaultColor", c)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </s-section>

          <s-section heading="Display rules">
            <div className="bfst-rule bfst-toggle-row">
              <s-switch
                label="Hide badges on sold-out products"
                labelAccessibilityVisibility="exclusive"
                checked={form.hideSoldOut}
                onChange={(e: CallbackEvent<"s-switch">) => set("hideSoldOut", switchValue(e))}
              />
              <div>
                <s-text fontWeight="bold">Hide badges on sold-out products</s-text>
                <div className="bfst-muted">
                  A sale badge on an unavailable product frustrates shoppers. Applies everywhere badges show: product
                  pages, collections, search results and product cards in other sections.
                </div>
              </div>
            </div>
            <div className="bfst-rule bfst-toggle-row">
              <s-switch
                label="One badge per product"
                labelAccessibilityVisibility="exclusive"
                checked={form.oneBadgePerProduct}
                disabled={!canStack}
                onChange={(e: CallbackEvent<"s-switch">) => set("oneBadgePerProduct", switchValue(e))}
              />
              <div>
                <s-text fontWeight="bold">One badge per product</s-text>
                <div className="bfst-muted">
                  When campaigns overlap, the newest one wins.{" "}
                  {canStack ? "Turn off to stack badges." : <>Stacking needs <Link to="/app/plan">Premium</Link>.</>}
                </div>
              </div>
            </div>
            <div className="bfst-rule bfst-toggle-row">
              <s-switch
                label="Shrink badges on mobile"
                labelAccessibilityVisibility="exclusive"
                checked={form.shrinkOnMobile}
                onChange={(e: CallbackEvent<"s-switch">) => set("shrinkOnMobile", switchValue(e))}
              />
              <div>
                <s-text fontWeight="bold">Shrink badges on mobile</s-text>
                <div className="bfst-muted">Drops the size by a quarter below 750px wide.</div>
              </div>
            </div>
          </s-section>

          <AiSettings ai={ai} />
        </div>

        <div className="bfst-col">
          <s-section>
            <s-heading>How new campaigns will look</s-heading>
            <div className="bfst-muted" style={{ marginBottom: 12 }}>Updates as you change the defaults.</div>
            <div className="bfst-preview">
              <div className="bfst-preview-card">
                <div className="bfst-preview-img">
                  {previewProduct?.imageUrl ? (
                    <img src={previewProduct.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <s-icon type="image" tone="neutral" />
                  )}
                  <span style={badgeStyle(form.defaultPosition, form.defaultSize, form.defaultColor)}>YOUR BADGE</span>
                </div>
                <div style={{ padding: "10px 12px" }}>
                  <div style={{ fontSize: 13 }}>{previewProduct?.title ?? "Sample product"}</div>
                  <div className="bfst-muted">{previewProduct?.price ?? "Add a product to see a real card"}</div>
                </div>
              </div>
            </div>

            <div className="bfst-divider" />

            <div className="bfst-muted">
              App embed: {embedOn ? "on in your live theme" : "off in your live theme"}.{" "}
              <Link to="/app/setup">{embedOn ? "Store setup" : "Turn it on"}</Link>
            </div>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}

type AiState = {
  available: boolean;
  provider: AiProvider;
  model: string | null;
  keyHint: string | null;
  verifiedAt: string | null;
};

function AiSettings({ ai }: { ai: AiState }) {
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher.data);
  const [provider, setProvider] = useState<AiProvider>(ai.provider);
  const [model, setModel] = useState(ai.model && PROVIDERS[ai.provider].models.some((m) => m.id === ai.model) ? ai.model : defaultModel(ai.provider));
  const [apiKey, setApiKey] = useState("");
  const busy = fetcher.state !== "idle";
  const pending = fetcher.formData?.get("intent");

  // Clear the pasted key once it's been saved.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setApiKey("");
  }, [fetcher.state, fetcher.data]);

  if (!ai.available) {
    return (
      <s-section heading="AI assistant">
        <div id="ai" />
        <s-paragraph>
          Connect your own Claude or OpenAI key and describe campaigns in plain words. Included with Premium and Unlimited.
        </s-paragraph>
        <s-stack direction="inline" gap="small-200">
          <s-button href="/app/plan">See plans</s-button>
          {ai.keyHint && (
            <s-button
              tone="critical"
              variant="tertiary"
              onClick={() => fetcher.submit({ intent: "ai-remove" }, { method: "post" })}
              loading={fetcher.state !== "idle"}
            >
              Remove stored key ending {ai.keyHint}
            </s-button>
          )}
        </s-stack>
      </s-section>
    );
  }

  const connected = !!ai.keyHint;
  const submit = (intent: string) =>
    fetcher.submit({ intent, aiProvider: provider, aiModel: model, aiKey: apiKey }, { method: "post" });

  return (
    <s-section heading="AI assistant">
      <div id="ai" />
      <s-stack direction="block" gap="base">
        <s-paragraph color="subdued">
          Bring your own key: you pay your AI provider directly at their rates, and BadgeFlow adds no AI charges. The key
          is stored encrypted and never shown again. When you use the assistant, your request, your store&apos;s timezone
          and your collection and product names are sent to the provider you choose.
        </s-paragraph>
        {connected && (
          <s-banner tone="success">
            Connected to {PROVIDERS[ai.provider].label} · key ending {ai.keyHint}
            {ai.verifiedAt ? ` · last checked ${ai.verifiedAt}` : ""}. <Link to="/app/ai">Open the AI assistant</Link>
          </s-banner>
        )}
        <s-select
          label="Provider"
          value={provider}
          onChange={(e: CallbackEvent<"s-select">) => {
            const next = e.currentTarget.value as AiProvider;
            setProvider(next);
            setModel(defaultModel(next));
          }}
        >
          {(Object.keys(PROVIDERS) as AiProvider[]).map((p) => (
            <s-option key={p} value={p}>{PROVIDERS[p].label}</s-option>
          ))}
        </s-select>
        <s-select label="Model" value={model} onChange={(e: CallbackEvent<"s-select">) => setModel(e.currentTarget.value)}>
          {PROVIDERS[provider].models.map((m) => (
            <s-option key={m.id} value={m.id}>{m.label}</s-option>
          ))}
        </s-select>
        <s-password-field
          label={connected ? "Replace API key" : "API key"}
          value={apiKey}
          autocomplete="off"
          details={PROVIDERS[provider].keyHelp}
          onInput={(e: CallbackEvent<"s-password-field">) => setApiKey(e.currentTarget.value)}
          onChange={(e: CallbackEvent<"s-password-field">) => setApiKey(e.currentTarget.value)}
        />
        <s-stack direction="inline" gap="small-200">
          <s-button variant="primary" onClick={() => submit("ai-connect")} disabled={busy || !apiKey.trim()} loading={busy && pending === "ai-connect"}>
            Save and test connection
          </s-button>
          {connected && (
            <s-button onClick={() => submit("ai-test")} disabled={busy} loading={busy && pending === "ai-test"}>
              Test again
            </s-button>
          )}
          {connected && (
            <s-button tone="critical" variant="tertiary" onClick={() => submit("ai-remove")} disabled={busy} loading={busy && pending === "ai-remove"}>
              Remove key
            </s-button>
          )}
        </s-stack>
        <s-text color="subdued" fontSize="small">
          If the key stops working or runs out of credit, only the assistant stops — every campaign keeps running.
        </s-text>
      </s-stack>
    </s-section>
  );
}
