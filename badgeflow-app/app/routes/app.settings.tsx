import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { BADGE_PRESETS, POSITIONS, positionLabel } from "../lib/badges";
import { BRAND } from "../lib/campaign";
import { fetchPreviewProducts } from "../lib/shopify-catalog.server";
import { useActionToast } from "../lib/use-toast";
import type { CallbackEvent } from "@shopify/polaris-types";
import { syncStorefront } from "../lib/storefront-sync.server";

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
  let price: string | null = null;
  if (product) {
    try {
      price = new Intl.NumberFormat("en", { style: "currency", currency: product.currency, currencyDisplay: "narrowSymbol" })
        .format(Number(product.price));
    } catch {
      price = `${product.price} ${product.currency}`;
    }
  }
  return {
    settings,
    // Stacking several badges on one product is a Premium feature.
    canStack: settings.plan !== "free",
    previewProduct: product ? { title: product.title, imageUrl: product.imageUrl, price } : null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const current = await db.shopSettings.findUnique({ where: { shop: session.shop } });
  const canStack = (current?.plan ?? "free") !== "free";

  const size = Number(formData.get("defaultSize") ?? 12);
  const position = String(formData.get("defaultPosition") ?? "top-left");
  const data = {
    appEnabled: formData.get("appEnabled") === "on",
    defaultColor: String(formData.get("defaultColor") ?? "#E33C2B"),
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

  await syncStorefront(admin, session.shop);
  return { ok: true, saved: true, savedAt: Date.now(), message: "Settings saved" };
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
.bfst-range { width: 100%; accent-color: #303030; margin: 6px 0 2px; }
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
    background: color, color: "#fff", fontWeight: 700, letterSpacing: ".02em",
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
  const { settings, canStack, previewProduct } = useLoaderData<typeof loader>();
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

  // After a save, the loader revalidates — re-sync so the bar closes.
  useEffect(() => {
    setForm(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

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
                <div className="bfst-label" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <label htmlFor="bfst-size">Default size</label>
                  <span className="bfst-muted" style={{ fontWeight: 400 }}>{form.defaultSize}% of the product image width</span>
                </div>
                <input
                  id="bfst-size"
                  className="bfst-range"
                  type="range"
                  min={MIN_SIZE}
                  max={MAX_SIZE}
                  step={1}
                  value={form.defaultSize}
                  onChange={(e) => set("defaultSize", Number(e.currentTarget.value))}
                />
                <div className="bfst-muted" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Small</span><span>Large</span>
                </div>
                <div className="bfst-muted" style={{ marginTop: 10 }}>
                  Sizes are relative, so the badge stays in proportion on phones and on large desktop grids.
                </div>

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
                <div className="bfst-muted">A sale badge on an unavailable product frustrates shoppers.</div>
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

            <s-text fontWeight="bold">AI assistant (Beta)</s-text>
            <div className="bfst-muted" style={{ margin: "2px 0 10px" }}>
              Get a sample draft campaign to start from, then change anything in the builder. Nothing goes live until you publish.
            </div>
            <s-button href="/app/ai">Open AI assistant</s-button>

            <div className="bfst-divider" />

            <div className="bfst-muted">
              Theme block status: {settings.embedConfirmedAt ? "enabled" : "not confirmed yet"}.{" "}
              <Link to="/app/setup">{settings.embedConfirmedAt ? "Recheck" : "Set it up"}</Link>
            </div>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}
