import { useState } from "react";
import { Link, useSubmit } from "react-router";
import type { CallbackEvent } from "@shopify/polaris-types";
import { BADGE_PRESETS, POSITIONS, positionLabel } from "../lib/badges";
import { PLANS, type PlanId } from "../lib/campaign";
import type { StoreCollection, PreviewProduct } from "../lib/shopify-catalog.server";

export type WizardInitial = {
  editingId?: string;
  name?: string;
  badgeId: string;
  badgeText: string;
  badgeColor: string;
  position: string;
  size: number;
  mobilePosition: string;
  mobileSize: number;
  targetType: string;
  targetRef: string;
  startNow: boolean;
  startAt: string;
  hasEndDate: boolean;
  endAt: string;
  startStep?: WizardStep;
};

type WizardStep = "design" | "products" | "schedule" | "review";
const ORDER: WizardStep[] = ["design", "products", "schedule", "review"];

// The stepper shows the three real decisions; "review" is the final
// confirmation screen after step 3, not a step of its own.
const STEPS: { key: Exclude<WizardStep, "review">; label: string; hint: string }[] = [
  { key: "design", label: "Design the badge", hint: "Label, colour, position" },
  { key: "products", label: "Choose products", hint: "All, a collection, or hand-picked" },
  { key: "schedule", label: "Set the schedule", hint: "Start now or pick dates" },
];

const COLORS = ["#E33C2B", "#B42318", "#161C2E", "#12795F", "#2B5FD9", "#E29405"];
const BADGE_TEXT_MAX = 22;
const SIZE_MIN = 8;
const SIZE_MAX = 24;

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function formatPrice(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

function overlayStyle(pos: string, sz: number, color: string, scale = 1): React.CSSProperties {
  return {
    position: "absolute",
    ...(pos.startsWith("top") ? { top: "6%" } : {}),
    ...(pos.startsWith("bottom") ? { bottom: "6%" } : {}),
    ...(pos.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
    ...(pos.endsWith("left") ? { left: "6%" } : {}),
    ...(pos.endsWith("right") ? { right: "6%" } : {}),
    ...(pos.endsWith("center") ? { left: "50%", transform: pos.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" } : {}),
    background: color, color: "#fff", fontWeight: 700, letterSpacing: ".02em",
    padding: "4px 8px", borderRadius: 4, fontSize: (6 + sz / 2) * scale, whiteSpace: "nowrap",
  };
}

const CSS = `
.bfw-wrap { display: grid; gap: 16px; padding-bottom: 8px; }
.bfw-sub { font-size: 13px; color: #616161; margin-top: -4px; }
.bfw-stepper { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); background: #fff; border-radius: 12px; box-shadow: 0 1px 0 rgba(26,26,26,.07), inset 0 0 0 1px rgba(26,26,26,.06); }
.bfw-step { display: flex; gap: 10px; align-items: flex-start; padding: 12px 16px; border: 0; background: none; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.bfw-step + .bfw-step { border-left: 1px solid #EBEBEB; }
.bfw-step-num { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 650; background: #F1F1F1; color: #616161; }
.bfw-step[data-state="active"] .bfw-step-num { background: #303030; color: #fff; }
.bfw-step[data-state="done"] .bfw-step-num { background: #CDFEE1; color: #0C5132; }
.bfw-step-label { font-size: 13px; font-weight: 600; }
.bfw-step[data-state="todo"] .bfw-step-label { color: #616161; }
.bfw-step-hint { font-size: 12px; color: #8A8A8A; }
.bfw-main { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.bfw-col { display: grid; gap: 16px; }
.bfw-muted { font-size: 12px; color: #616161; }
.bfw-label { font-size: 13px; font-weight: 550; margin-bottom: 6px; }
.bfw-eyebrow { font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: #616161; }
.bfw-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.bfw-tile { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; border: 1px solid #E3E3E3; background: #fff; cursor: pointer; font: inherit; color: inherit; text-align: left; min-width: 0; }
.bfw-tile:hover { border-color: #B5B5B5; }
.bfw-tile[aria-pressed="true"] { border: 2px solid #303030; padding: 9px; box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.bfw-pill { display: inline-block; padding: 3px 7px; border-radius: 4px; color: #fff; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.bfw-fine { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 20px; }
.bfw-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.bfw-swatch { width: 30px; height: 30px; border-radius: 6px; border: 0; padding: 0; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
.bfw-swatch[aria-pressed="true"] { outline: 2px solid #303030; outline-offset: 2px; }
.bfw-range { width: 100%; accent-color: #303030; }
.bfw-posgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 8px; background: #F7F7F7; border-radius: 10px; border: 1px solid #EBEBEB; }
.bfw-pos { position: relative; aspect-ratio: 4/3; border-radius: 6px; border: 1px solid #E3E3E3; background: #fff; cursor: pointer; padding: 0; }
.bfw-pos[aria-pressed="true"] { border: 2px solid #303030; }
.bfw-pos-mark { position: absolute; width: 30%; height: 12%; border-radius: 2px; background: #D4D4D4; }
.bfw-seg { display: inline-flex; background: #F1F1F1; border-radius: 8px; padding: 2px; }
.bfw-seg button { border: 0; background: none; font: inherit; font-size: 12px; font-weight: 550; padding: 4px 10px; border-radius: 6px; cursor: pointer; color: #616161; }
.bfw-seg button[aria-pressed="true"] { background: #fff; color: #303030; box-shadow: 0 1px 2px rgba(0,0,0,.12); }
.bfw-card { border: 1px solid #EBEBEB; border-radius: 10px; overflow: hidden; background: #fff; margin: 12px auto 0; }
.bfw-card-img { position: relative; aspect-ratio: 1/1; background: #F1F1F1; overflow: hidden; }
.bfw-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bfw-where { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; font-size: 12.5px; }
.bfw-where li { display: flex; gap: 6px; align-items: center; }
.bfw-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.bfw-option { display: block; padding: 12px; border-radius: 8px; border: 1px solid #E3E3E3; background: #fff; cursor: pointer; font: inherit; color: inherit; text-align: left; }
.bfw-option[aria-pressed="true"] { border: 2px solid #303030; padding: 11px; }
.bfw-list { display: grid; gap: 6px; }
.bfw-meter { height: 6px; border-radius: 3px; background: #EBEBEB; overflow: hidden; margin: 6px 0; }
.bfw-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bfw-summary { display: grid; }
.bfw-summary > div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #F1F1F1; font-size: 13px; }
.bfw-summary > div:last-child { border-bottom: 0; }
.bfw-note { border-radius: 8px; padding: 10px 12px; font-size: 12.5px; }
.bfw-note-warn { background: #FFF1E3; color: #5E4200; }
.bfw-note-crit { background: #FEE9E8; color: #8E1F0B; }
.bfw-footer { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fff; border-radius: 12px; padding: 10px 16px; box-shadow: 0 -1px 0 rgba(26,26,26,.06), 0 1px 0 rgba(26,26,26,.07), inset 0 0 0 1px rgba(26,26,26,.06); }
.bfw-footer-actions { display: flex; align-items: center; gap: 8px; }
.bfw-cancel { font-size: 13px; color: #303030; text-decoration: none; }
.bfw-cancel:hover { text-decoration: underline; }
@media (max-width: 900px) {
  .bfw-main { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .bfw-stepper { grid-template-columns: minmax(0, 1fr); }
  .bfw-step + .bfw-step { border-left: 0; border-top: 1px solid #EBEBEB; }
  .bfw-presets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bfw-fine { grid-template-columns: minmax(0, 1fr); }
  .bfw-options { grid-template-columns: minmax(0, 1fr); }
  .bfw-hint { display: none; }
}
`;

export function CampaignWizard({
  initial,
  collections,
  totalProducts,
  plan,
  previewProduct,
  sampleThumbs,
  embedConfirmed,
  timezone,
  errors,
}: {
  initial: WizardInitial;
  collections: StoreCollection[];
  totalProducts: number;
  plan: PlanId;
  previewProduct: PreviewProduct | null;
  sampleThumbs: PreviewProduct[];
  embedConfirmed: boolean;
  timezone: string;
  errors: Record<string, string>;
}) {
  const submit = useSubmit();
  const [step, setStep] = useState<WizardStep>(initial.startStep ?? "design");

  const [campaignName, setCampaignName] = useState(initial.name ?? "");
  const [selectedPresetId, setSelectedPresetId] = useState(initial.badgeId);
  const [badgeText, setBadgeText] = useState(initial.badgeText);
  const [badgeColor, setBadgeColor] = useState(initial.badgeColor);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [position, setPosition] = useState(initial.position);
  const [size, setSize] = useState(initial.size);
  const [mobilePosition, setMobilePosition] = useState(initial.mobilePosition || initial.position);
  const [mobileSize, setMobileSize] = useState(initial.mobileSize || initial.size);

  const [targetType, setTargetType] = useState(initial.targetType);
  const [collectionId, setCollectionId] = useState(
    initial.targetType === "collection" ? initial.targetRef : (collections[0]?.id ?? ""),
  );
  const [productHandles, setProductHandles] = useState(
    initial.targetType === "products" ? initial.targetRef : "",
  );

  const [startNow, setStartNow] = useState(initial.startNow);
  const [startAt, setStartAt] = useState(initial.startAt || nowLocalInput());
  const [hasEndDate, setHasEndDate] = useState(initial.hasEndDate);
  const [endAt, setEndAt] = useState(initial.endAt);

  const selectedPreset = BADGE_PRESETS.find((b) => b.id === selectedPresetId);
  const isSaleFlavored = selectedPreset?.category === "Sale";

  const selectedCollection = collections.find((c) => c.id === collectionId);
  const productsCount =
    targetType === "all"
      ? totalProducts
      : targetType === "collection"
        ? (selectedCollection?.productsCount ?? 0)
        : productHandles.split(",").map((h) => h.trim()).filter(Boolean).length;
  const targetLabel =
    targetType === "all"
      ? "All products"
      : targetType === "collection"
        ? `${selectedCollection?.title ?? "Collection"} — ${productsCount} products`
        : `${productsCount} individual product${productsCount === 1 ? "" : "s"}`;
  const targetRef = targetType === "all" ? "" : targetType === "collection" ? collectionId : productHandles;

  const limit = PLANS[plan].limit;
  const overLimit = productsCount > limit;
  const effectiveStart = startNow ? nowLocalInput() : startAt;

  function buildFormData(intent: "draft" | "publish") {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("campaignName", campaignName);
    fd.set("badgeId", selectedPresetId);
    fd.set("badgeText", badgeText);
    fd.set("badgeColor", badgeColor);
    fd.set("position", position);
    fd.set("size", String(size));
    fd.set("mobilePosition", mobilePosition);
    fd.set("mobileSize", String(mobileSize));
    fd.set("targetType", targetType);
    fd.set("targetRef", targetRef);
    fd.set("targetLabel", targetLabel);
    fd.set("productsCount", String(productsCount));
    fd.set("startAt", effectiveStart);
    fd.set("endAt", hasEndDate ? endAt : "");
    return fd;
  }

  const stepIndex = ORDER.indexOf(step);
  const goNext = () => stepIndex < ORDER.length - 1 && setStep(ORDER[stepIndex + 1]!);
  const goBack = () => stepIndex > 0 && setStep(ORDER[stepIndex - 1]!);
  const saveDraft = () => submit(buildFormData("draft"), { method: "post" });
  const publish = () => {
    if (!overLimit) submit(buildFormData("publish"), { method: "post" });
  };

  const currentPosition = device === "desktop" ? position : mobilePosition;
  const setCurrentPosition = device === "desktop" ? setPosition : setMobilePosition;
  const currentSize = device === "desktop" ? size : mobileSize;
  const setCurrentSize = device === "desktop" ? setSize : setMobileSize;

  const heading = initial.editingId ? "Edit campaign" : "Create campaign";
  const subheading = step === "review"
    ? "Review · nothing goes live until you publish"
    : `Step ${stepIndex + 1} of 3 · nothing goes live until you publish`;

  const next: Record<WizardStep, { label: string; hint: string }> = {
    design: { label: "Next: choose products", hint: "You can still change everything in step 2 and 3." },
    products: { label: "Next: set the schedule", hint: `${productsCount} product${productsCount === 1 ? "" : "s"} selected.` },
    schedule: { label: "Next: review", hint: `Times are in ${timezone}.` },
    review: { label: startNow ? "Publish now" : "Schedule campaign", hint: "Publishing is the only step that changes your storefront." },
  };

  const previewPanel = (
    <s-section>
      <div className="bfw-row">
        <s-heading>Live preview</s-heading>
        <div className="bfw-seg" role="group" aria-label="Preview device">
          <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}>Desktop</button>
          <button type="button" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}>Mobile</button>
        </div>
      </div>
      <div className="bfw-muted" style={{ marginTop: 4 }}>
        {previewProduct ? "This is your real collection-page card." : "Add a product to your store to preview on a real card."}
      </div>
      <div className="bfw-card" style={{ maxWidth: device === "mobile" ? 170 : 280 }}>
        <div className="bfw-card-img">
          {previewProduct?.imageUrl ? (
            <img src={previewProduct.imageUrl} alt="" />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <s-icon type="image" tone="neutral" />
            </div>
          )}
          <span style={overlayStyle(currentPosition, currentSize, badgeColor, device === "mobile" ? 0.8 : 1)}>
            {badgeText || "BADGE"}
          </span>
        </div>
        <div style={{ padding: "8px 10px" }}>
          <div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {previewProduct?.title ?? "Sample product"}
          </div>
          {previewProduct && <div className="bfw-muted">{formatPrice(previewProduct.price, previewProduct.currency)}</div>}
        </div>
      </div>
      <div style={{ borderTop: "1px solid #EBEBEB", marginTop: 16, paddingTop: 12 }}>
        <div className="bfw-eyebrow">Where it will appear</div>
        <ul className="bfw-where">
          <li><s-icon type="check" tone="success" size="small" />Collection pages and search results</li>
          <li><s-icon type="check" tone="success" size="small" />Product pages and the home page</li>
          <li style={{ color: "#8A8A8A" }}><s-icon type="x" tone="neutral" size="small" />Cart and checkout (not supported by Shopify)</li>
        </ul>
      </div>
    </s-section>
  );

  return (
    <s-page heading={heading} inlineSize="large">
      <style>{CSS}</style>
      <s-link slot="breadcrumb-actions" href="/app/campaigns">Campaigns</s-link>

      <div className="bfw-wrap">
        <div className="bfw-sub">{subheading}</div>

        <nav className="bfw-stepper" aria-label="Campaign steps">
          {STEPS.map((s, i) => {
            const state = s.key === step ? "active" : i < stepIndex ? "done" : "todo";
            return (
              <button key={s.key} type="button" className="bfw-step" data-state={state} onClick={() => setStep(s.key)}
                aria-current={state === "active" ? "step" : undefined}>
                <span className="bfw-step-num">{state === "done" ? "✓" : i + 1}</span>
                <span>
                  <span className="bfw-step-label" style={{ display: "block" }}>{s.label}</span>
                  <span className="bfw-step-hint">{s.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="bfw-main">
          <div className="bfw-col">
            {step === "design" && (
              <>
                <s-section>
                  <s-heading>Start from a badge</s-heading>
                  <div className="bfw-muted">Pick one and edit it — or write your own below.</div>
                  <div className="bfw-presets">
                    {BADGE_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className="bfw-tile"
                        aria-pressed={selectedPresetId === preset.id}
                        aria-label={`Use ${preset.label} badge`}
                        onClick={() => {
                          setSelectedPresetId(preset.id);
                          setBadgeText(preset.label);
                          setBadgeColor(preset.color);
                        }}
                      >
                        <span className="bfw-pill" style={{ background: preset.color }}>{preset.label}</span>
                        <span className="bfw-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preset.category}</span>
                      </button>
                    ))}
                  </div>
                  {isSaleFlavored && (
                    <div className="bfw-note bfw-note-warn" style={{ marginTop: 12 }}>
                      A sale badge only changes what shoppers see on the image — it doesn&apos;t create a Shopify discount. Set up the actual discount separately if the badge references one.
                    </div>
                  )}
                </s-section>

                <s-section>
                  <s-heading>Fine-tune it</s-heading>
                  <div className="bfw-fine" style={{ marginTop: 12 }}>
                    <s-stack direction="block" gap="base">
                      <s-text-field
                        label="Badge text"
                        value={badgeText}
                        onInput={(e: CallbackEvent<"s-text-field">) => setBadgeText(e.currentTarget.value)}
                        onChange={(e: CallbackEvent<"s-text-field">) => setBadgeText(e.currentTarget.value)}
                        maxLength={BADGE_TEXT_MAX}
                        error={errors.badgeText}
                        details={`${badgeText.length} of ${BADGE_TEXT_MAX} characters — short badges read better on phones.`}
                      />
                      <div>
                        <div className="bfw-label">Colour</div>
                        <div className="bfw-swatches">
                          {[...COLORS, ...(COLORS.includes(badgeColor) ? [] : [badgeColor])].map((c) => (
                            <button key={c} type="button" className="bfw-swatch" style={{ background: c }}
                              aria-label={`Colour ${c}`} aria-pressed={badgeColor === c} onClick={() => setBadgeColor(c)} />
                          ))}
                        </div>
                      </div>
                      <div>
                        <div className="bfw-row">
                          <div className="bfw-label" style={{ marginBottom: 0 }}>Size{device === "mobile" ? " on mobile" : ""}</div>
                          <div className="bfw-muted">{currentSize}% of the product image</div>
                        </div>
                        <input
                          type="range"
                          className="bfw-range"
                          min={SIZE_MIN}
                          max={SIZE_MAX}
                          value={currentSize}
                          aria-label="Badge size"
                          onChange={(e) => setCurrentSize(Number(e.currentTarget.value))}
                        />
                      </div>
                      <s-text-field
                        label="Campaign name"
                        value={campaignName}
                        onChange={(e: CallbackEvent<"s-text-field">) => setCampaignName(e.currentTarget.value)}
                        placeholder={`${targetLabel} — ${badgeText || "badge"}`}
                        details="Only you see this. Leave blank to use a generated name."
                        maxLength={60}
                      />
                    </s-stack>
                    <div>
                      <div className="bfw-label">Position on the image{device === "mobile" ? " (mobile)" : ""}</div>
                      <div className="bfw-posgrid">
                        {POSITIONS.map((p) => (
                          <button key={p} type="button" className="bfw-pos" aria-label={positionLabel(p)}
                            aria-pressed={currentPosition === p} onClick={() => setCurrentPosition(p)}>
                            <span
                              className="bfw-pos-mark"
                              style={{
                                ...(p.startsWith("top") ? { top: "14%" } : p.startsWith("bottom") ? { bottom: "14%" } : { top: "44%" }),
                                ...(p.endsWith("left") ? { left: "12%" } : p.endsWith("right") ? { right: "12%" } : { left: "35%" }),
                                ...(currentPosition === p ? { background: badgeColor } : {}),
                              }}
                            />
                          </button>
                        ))}
                      </div>
                      <div className="bfw-muted" style={{ marginTop: 8 }}>
                        Top-left is safest — most themes put the price and wishlist icon on the right.
                      </div>
                    </div>
                  </div>
                </s-section>
              </>
            )}

            {step === "products" && (
              <s-section>
                <s-heading>Which products get the badge?</s-heading>
                <div className="bfw-muted" style={{ marginBottom: 12 }}>Collections stay dynamic — products added later get the badge too.</div>
                <div className="bfw-options">
                  {[
                    { value: "all", label: "All products", hint: `${totalProducts} in your store` },
                    { value: "collection", label: "A collection", hint: `${collections.length} available` },
                    { value: "products", label: "Hand-picked", hint: "By product handle" },
                  ].map((o) => (
                    <button key={o.value} type="button" className="bfw-option" aria-pressed={targetType === o.value}
                      onClick={() => setTargetType(o.value)}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{o.label}</div>
                      <div className="bfw-muted">{o.hint}</div>
                    </button>
                  ))}
                </div>

                {targetType === "collection" && (
                  <div style={{ marginTop: 16 }}>
                    {collections.length === 0 ? (
                      <s-text color="subdued" fontSize="small">No collections found in this store yet.</s-text>
                    ) : (
                      <div className="bfw-list">
                        {collections.map((c) => (
                          <button key={c.id} type="button" className="bfw-option bfw-row" aria-pressed={collectionId === c.id}
                            onClick={() => setCollectionId(c.id)}>
                            <span style={{ fontSize: 13, fontWeight: collectionId === c.id ? 600 : 400 }}>{c.title}</span>
                            <span className="bfw-muted">{c.productsCount} products</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {errors.targetValue && <div className="bfw-note bfw-note-crit" style={{ marginTop: 8 }}>{errors.targetValue}</div>}
                  </div>
                )}

                {targetType === "products" && (
                  <div style={{ marginTop: 16 }}>
                    <s-text-field
                      label="Product handles (comma-separated)"
                      value={productHandles}
                      onChange={(e: CallbackEvent<"s-text-field">) => setProductHandles(e.currentTarget.value)}
                      placeholder={sampleThumbs.length ? sampleThumbs.slice(0, 2).map((p) => p.handle).join(", ") : "e.g. linen-overshirt, canvas-tote"}
                      error={errors.targetValue}
                    />
                  </div>
                )}

                <div style={{ marginTop: 16 }}>
                  <div className="bfw-row">
                    <div className="bfw-label" style={{ marginBottom: 0 }}>Plan usage</div>
                    <div className="bfw-muted">{productsCount} / {limit === Infinity ? "∞" : limit}</div>
                  </div>
                  {limit !== Infinity && (
                    <div className="bfw-meter">
                      <div style={{ width: `${Math.min(100, (productsCount / limit) * 100)}%`, height: "100%", background: overLimit ? "#C70A24" : "#303030" }} />
                    </div>
                  )}
                  <div className="bfw-muted" style={overLimit ? { color: "#8E1F0B" } : undefined}>
                    {overLimit
                      ? `${productsCount} products is over your ${PLANS[plan].label} plan's ${limit}-product limit.`
                      : `Fits the ${PLANS[plan].label} plan.`}
                    {overLimit && <> <Link to="/app/plan">See plans</Link></>}
                  </div>
                </div>
              </s-section>
            )}

            {step === "schedule" && (
              <s-section>
                <s-heading>When should it run?</s-heading>
                <div className="bfw-muted" style={{ marginBottom: 12 }}>Badges switch on and off by themselves — times are in {timezone}.</div>
                <div className="bfw-options" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  <button type="button" className="bfw-option" aria-pressed={startNow} onClick={() => setStartNow(true)}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Start now</div>
                    <div className="bfw-muted">Live as soon as you publish</div>
                  </button>
                  <button type="button" className="bfw-option" aria-pressed={!startNow} onClick={() => setStartNow(false)}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>Pick a start date</div>
                    <div className="bfw-muted">Schedule it ahead</div>
                  </button>
                </div>
                <s-stack direction="block" gap="base">
                  {!startNow && (
                    <s-box paddingBlockStart="base">
                      <s-date-field
                        label="Start"
                        value={startAt}
                        onChange={(e: CallbackEvent<"s-date-field">) => setStartAt(e.currentTarget.value)}
                        error={errors.startAt}
                      />
                    </s-box>
                  )}
                  <s-box paddingBlockStart="base">
                    <s-switch
                      label="Set an end date"
                      checked={hasEndDate}
                      onChange={(e: CallbackEvent<"s-switch">) => setHasEndDate(Boolean(e.currentTarget.checked))}
                    />
                  </s-box>
                  {hasEndDate && (
                    <s-date-field
                      label="End"
                      value={endAt}
                      onChange={(e: CallbackEvent<"s-date-field">) => setEndAt(e.currentTarget.value)}
                      error={errors.endAt}
                    />
                  )}
                  {startNow && errors.startAt && <div className="bfw-note bfw-note-crit">{errors.startAt}</div>}
                </s-stack>
              </s-section>
            )}

            {step === "review" && (
              <s-section>
                <s-heading>Review and publish</s-heading>
                <div className="bfw-muted" style={{ marginBottom: 8 }}>Check the details — you can jump back to any step above.</div>
                {!embedConfirmed && (
                  <div className="bfw-note bfw-note-warn" style={{ margin: "8px 0" }}>
                    <b>Storefront won&apos;t show this yet.</b> The app embed is still off. <Link to="/app/setup">Go to setup</Link>
                  </div>
                )}
                <div className="bfw-summary">
                  {[
                    ["Badge", <span key="b" className="bfw-pill" style={{ background: badgeColor }}>{badgeText}</span>],
                    ["Position", `${positionLabel(position)} · ${size}%${mobilePosition !== position || mobileSize !== size ? ` (mobile: ${positionLabel(mobilePosition)} · ${mobileSize}%)` : ""}`],
                    ["Products", targetLabel],
                    ["Starts", startNow ? "Immediately, when published" : new Date(startAt).toLocaleString()],
                    ["Ends", hasEndDate && endAt ? new Date(endAt).toLocaleString() : "No end date"],
                    ["Timezone", timezone],
                    ["Theme connection", embedConfirmed ? "Confirmed" : "Not confirmed yet"],
                    ["Plan check", `${productsCount} of ${limit === Infinity ? "∞" : limit} — ${PLANS[plan].label} plan${overLimit ? "" : " ✓"}`],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <span className="bfw-muted" style={{ fontSize: 13 }}>{k}</span>
                      <span style={{ fontWeight: 550, textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                </div>
                {isSaleFlavored && (
                  <div className="bfw-note bfw-note-warn" style={{ marginTop: 8 }}>Reminder: this badge doesn&apos;t create a Shopify discount on its own.</div>
                )}
                {overLimit && (
                  <div className="bfw-note bfw-note-crit" style={{ marginTop: 8 }}>
                    {productsCount} products needs more room than the {PLANS[plan].label} plan&apos;s {limit}-product limit.{" "}
                    <Link to="/app/plan">See plans</Link> or reduce the products in step 2.
                  </div>
                )}
                {(errors.startAt || errors.endAt || errors.badgeText || errors.targetValue) && (
                  <div className="bfw-note bfw-note-crit" style={{ marginTop: 8 }}>
                    {[errors.badgeText, errors.targetValue, errors.startAt, errors.endAt].filter(Boolean).join(" · ")}
                  </div>
                )}
              </s-section>
            )}
          </div>

          <div className="bfw-col">{previewPanel}</div>
        </div>

        <div className="bfw-footer">
          {stepIndex === 0 ? (
            <Link to="/app/campaigns" className="bfw-cancel">Cancel</Link>
          ) : (
            <s-button variant="tertiary" onClick={goBack}>Back</s-button>
          )}
          <div className="bfw-footer-actions">
            <span className="bfw-muted bfw-hint">{next[step].hint}</span>
            <s-button onClick={saveDraft}>Save as draft</s-button>
            {step === "review" ? (
              <s-button variant="primary" onClick={publish} disabled={overLimit}>{next.review.label}</s-button>
            ) : (
              <s-button variant="primary" onClick={goNext}>{next[step].label} ›</s-button>
            )}
          </div>
        </div>
      </div>
    </s-page>
  );
}
