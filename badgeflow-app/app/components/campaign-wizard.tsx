import { useMemo, useState } from "react";
import { useNavigate, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { CallbackEvent } from "@shopify/polaris-types";
import { BADGE_PRESETS, POSITIONS, claimWarning, positionLabel } from "../lib/badges";
import { PLANS, type PlanId } from "../lib/campaign";
import { formatInZone, TIME_OPTIONS, zonedToUtc } from "../lib/timezone";
import type { PreviewProduct } from "../lib/shopify-catalog.server";
import { useEmbedStatus } from "../lib/use-embed-status";

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
  targetLabel: string;
  targetCount?: number;
  pickedProducts: { id: string; title: string }[];
  startNow: boolean;
  startDate: string;
  startTime: string;
  hasEndDate: boolean;
  endDate: string;
  endTime: string;
};

type WizardErrors = Partial<Record<"badgeText" | "badgeColor" | "position" | "size" | "targetValue" | "startAt" | "endAt" | "form", string>>;

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
const MAX_PICKED = 250;

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

function timeOptions(current: string): string[] {
  return TIME_OPTIONS.includes(current) ? TIME_OPTIONS : [...TIME_OPTIONS, current].sort();
}

const CSS = `
.bfw-wrap { display: grid; gap: 16px; padding-bottom: 8px; }
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
.bfw-label { font-size: 13px; font-weight: 550; margin-bottom: 6px; }
.bfw-presets { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.bfw-tile { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; border: 1px solid #E3E3E3; background: #fff; cursor: pointer; font: inherit; color: inherit; text-align: left; min-width: 0; }
.bfw-tile:hover { border-color: #B5B5B5; }
.bfw-tile[aria-pressed="true"] { border: 2px solid #303030; padding: 9px; }
.bfw-pill { display: inline-block; padding: 3px 7px; border-radius: 4px; color: #fff; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.bfw-fine { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 20px; }
.bfw-swatches { display: flex; gap: 8px; flex-wrap: wrap; }
.bfw-swatch { width: 30px; height: 30px; border-radius: 6px; border: 0; padding: 0; cursor: pointer; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
.bfw-swatch[aria-pressed="true"] { outline: 2px solid #303030; outline-offset: 2px; }
.bfw-posgrid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 8px; background: #F7F7F7; border-radius: 10px; border: 1px solid #EBEBEB; }
.bfw-pos { position: relative; aspect-ratio: 4/3; border-radius: 6px; border: 1px solid #E3E3E3; background: #fff; cursor: pointer; padding: 0; }
.bfw-pos[aria-pressed="true"] { border: 2px solid #303030; }
.bfw-pos-mark { position: absolute; width: 30%; height: 12%; border-radius: 2px; background: #D4D4D4; }
.bfw-card { border: 1px solid #EBEBEB; border-radius: 10px; overflow: hidden; background: #fff; margin: 12px auto 0; }
.bfw-card-img { position: relative; aspect-ratio: 1/1; background: #F1F1F1; overflow: hidden; }
.bfw-card-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bfw-meter { height: 6px; border-radius: 3px; background: #EBEBEB; overflow: hidden; margin: 6px 0; }
.bfw-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.bfw-summary { display: grid; }
.bfw-summary > div { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid #F1F1F1; font-size: 13px; }
.bfw-summary > div:last-child { border-bottom: 0; }
.bfw-dates { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; }
.bfw-footer { position: sticky; bottom: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #fff; border-radius: 12px; padding: 10px 16px; box-shadow: 0 -1px 0 rgba(26,26,26,.06), 0 1px 0 rgba(26,26,26,.07), inset 0 0 0 1px rgba(26,26,26,.06); }
@media (max-width: 900px) {
  .bfw-main { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .bfw-stepper { grid-template-columns: minmax(0, 1fr); }
  .bfw-step + .bfw-step { border-left: 0; border-top: 1px solid #EBEBEB; }
  .bfw-presets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bfw-fine, .bfw-dates { grid-template-columns: minmax(0, 1fr); }
  .bfw-hint { display: none; }
}
`;

export function CampaignWizard({
  initial,
  totalProducts,
  plan,
  previewProduct,
  embedConfirmed,
  timezone,
  errors,
}: {
  initial: WizardInitial;
  totalProducts: number;
  plan: PlanId;
  previewProduct: PreviewProduct | null;
  embedConfirmed: boolean;
  timezone: string;
  errors: WizardErrors;
}) {
  const submit = useSubmit();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const embedOn = useEmbedStatus(embedConfirmed).active;
  const [step, setStep] = useState<WizardStep>("design");
  const [pendingIntent, setPendingIntent] = useState<"draft" | "publish" | null>(null);
  const busy = navigation.state !== "idle" && navigation.formMethod?.toLowerCase() === "post";

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
  const [collection, setCollection] = useState<{ id: string; title: string; count: number } | null>(
    initial.targetType === "collection" && initial.targetRef
      ? { id: initial.targetRef, title: initial.targetLabel.split(" — ")[0] ?? "Collection", count: initial.targetCount ?? 0 }
      : null,
  );
  const [products, setProducts] = useState(initial.pickedProducts);

  const [startNow, setStartNow] = useState(initial.startNow);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [hasEndDate, setHasEndDate] = useState(initial.hasEndDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [endTime, setEndTime] = useState(initial.endTime);

  const warning = claimWarning(selectedPresetId, badgeText);

  const productsCount =
    targetType === "all" ? totalProducts : targetType === "collection" ? (collection?.count ?? 0) : products.length;
  const targetLabel =
    targetType === "all"
      ? "All products"
      : targetType === "collection"
        ? collection
          ? `${collection.title} — ${collection.count} products`
          : "No collection chosen"
        : `${products.length} individual product${products.length === 1 ? "" : "s"}`;
  const targetRef = targetType === "all" ? "" : targetType === "collection" ? (collection?.id ?? "") : products.map((p) => p.id).join(",");

  const limit = PLANS[plan].limit;
  const overLimit = productsCount > limit;

  const snapshot = JSON.stringify([
    campaignName, badgeText, badgeColor, position, size, mobilePosition, mobileSize, targetType, targetRef,
    startNow, startDate, startTime, hasEndDate, endDate, endTime,
  ]);
  const initialSnapshot = useMemo(
    () =>
      JSON.stringify([
        initial.name ?? "", initial.badgeText, initial.badgeColor, initial.position, initial.size,
        initial.mobilePosition || initial.position, initial.mobileSize || initial.size, initial.targetType,
        initial.targetType === "all" ? "" : initial.targetType === "collection" ? initial.targetRef : initial.pickedProducts.map((p) => p.id).join(","),
        initial.startNow, initial.startDate, initial.startTime, initial.hasEndDate, initial.endDate, initial.endTime,
      ]),
    [initial],
  );
  const dirty = snapshot !== initialSnapshot;

  const startInstant = startNow ? null : zonedToUtc(startDate, startTime, timezone);
  const endInstant = hasEndDate ? zonedToUtc(endDate, endTime, timezone) : null;

  function buildFormData(intent: "draft" | "publish") {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("campaignName", campaignName);
    fd.set("badgeText", badgeText);
    fd.set("badgeColor", badgeColor);
    fd.set("position", position);
    fd.set("size", String(size));
    fd.set("mobilePosition", mobilePosition);
    fd.set("mobileSize", String(mobileSize));
    fd.set("targetType", targetType);
    fd.set("targetRef", targetRef);
    fd.set("targetLabel", targetLabel);
    fd.set("startMode", startNow ? "now" : "date");
    fd.set("startDate", startDate);
    fd.set("startTime", startTime);
    fd.set("hasEnd", hasEndDate ? "1" : "0");
    fd.set("endDate", endDate);
    fd.set("endTime", endTime);
    return fd;
  }

  const stepIndex = ORDER.indexOf(step);
  const goNext = () => stepIndex < ORDER.length - 1 && setStep(ORDER[stepIndex + 1]!);
  const goBack = () => stepIndex > 0 && setStep(ORDER[stepIndex - 1]!);
  function send(intent: "draft" | "publish") {
    if (busy) return;
    setPendingIntent(intent);
    submit(buildFormData(intent), { method: "post" });
  }

  async function pickCollection() {
    const picked = await shopify.resourcePicker({
      type: "collection",
      action: "select",
      multiple: false,
      selectionIds: collection ? [{ id: collection.id }] : [],
    });
    const c = picked?.[0];
    if (c) setCollection({ id: c.id, title: c.title, count: c.productsCount ?? 0 });
  }

  async function pickProducts() {
    const picked = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: MAX_PICKED,
      filter: { variants: false },
      selectionIds: products.filter((p) => p.id.startsWith("gid://")).map((p) => ({ id: p.id })),
    });
    if (picked) setProducts(picked.map((p) => ({ id: p.id, title: p.title })));
  }

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

  const errorList = [errors.form, errors.badgeText, errors.badgeColor, errors.position, errors.size, errors.targetValue, errors.startAt, errors.endAt].filter(Boolean);

  const previewPanel = (
    <s-section>
      <div className="bfw-row">
        <s-heading>Live preview</s-heading>
        <s-button-group gap="none" accessibilityLabel="Preview device">
          <s-button slot="secondary-actions" variant={device === "desktop" ? "primary" : "secondary"} onClick={() => setDevice("desktop")}>Desktop</s-button>
          <s-button slot="secondary-actions" variant={device === "mobile" ? "primary" : "secondary"} onClick={() => setDevice("mobile")}>Mobile</s-button>
        </s-button-group>
      </div>
      <s-text color="subdued" fontSize="small">
        {previewProduct ? "A product from your store, as a collection-page card." : "Add a product to your store to preview on a real card."}
      </s-text>
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
          {previewProduct && <s-text color="subdued" fontSize="small">{formatPrice(previewProduct.price, previewProduct.currency)}</s-text>}
        </div>
      </div>
      <s-box paddingBlockStart="base">
        <s-divider />
      </s-box>
      <s-box paddingBlockStart="base">
        <s-text fontWeight="bold">Where it will appear</s-text>
        <s-unordered-list>
          <s-list-item>Collection pages, search results and the home page</s-list-item>
          <s-list-item>Product pages</s-list-item>
          <s-list-item>Not in cart or checkout (Shopify doesn&apos;t allow it)</s-list-item>
        </s-unordered-list>
      </s-box>
    </s-section>
  );

  return (
    <s-page heading={heading} inlineSize="large">
      <style>{CSS}</style>
      <s-link slot="breadcrumb-actions" href="/app/campaigns">Campaigns</s-link>

      <div className="bfw-wrap">
        <s-text color="subdued">{subheading}</s-text>

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

        {errorList.length > 0 && (
          <s-banner tone="critical" heading="Fix these before saving">
            {errorList.join(" · ")}
          </s-banner>
        )}

        <div className="bfw-main">
          <div className="bfw-col">
            {step === "design" && (
              <>
                <s-section>
                  <s-heading>Start from a badge</s-heading>
                  <s-text color="subdued" fontSize="small">Pick one and edit it — or write your own below.</s-text>
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
                        <s-text color="subdued" fontSize="small">{preset.category}</s-text>
                      </button>
                    ))}
                  </div>
                  {warning && (
                    <s-box paddingBlockStart="base">
                      <s-banner tone="warning">{warning}</s-banner>
                    </s-box>
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
                      <s-number-field
                        label={device === "mobile" ? "Size on mobile" : "Size"}
                        value={String(currentSize)}
                        min={SIZE_MIN}
                        max={SIZE_MAX}
                        step={1}
                        suffix="%"
                        details="Share of the product image, so it scales with the card."
                        error={errors.size}
                        onChange={(e: CallbackEvent<"s-number-field">) => {
                          const n = Math.round(Number(e.currentTarget.value));
                          if (Number.isFinite(n)) setCurrentSize(Math.min(SIZE_MAX, Math.max(SIZE_MIN, n)));
                        }}
                      />
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
                      <s-box paddingBlockStart="small-200">
                        <s-text color="subdued" fontSize="small">
                          Top-left is safest — most themes put the price and wishlist icon on the right. Switch the
                          preview to Mobile to set a separate mobile position and size.
                        </s-text>
                      </s-box>
                    </div>
                  </div>
                </s-section>
              </>
            )}

            {step === "products" && (
              <s-section>
                <s-stack direction="block" gap="base">
                  <s-choice-list
                    label="Which products get the badge?"
                    name="targetType"
                    values={[targetType]}
                    error={errors.targetValue}
                    onChange={(e: CallbackEvent<"s-choice-list">) => setTargetType(e.currentTarget.values[0] ?? "all")}
                  >
                    <s-choice value="all">
                      All products
                      <s-text slot="details">{totalProducts} in your store, including products added later.</s-text>
                    </s-choice>
                    <s-choice value="collection">
                      A collection
                      <s-text slot="details">Products added to the collection later get the badge within a few minutes.</s-text>
                    </s-choice>
                    <s-choice value="products">
                      Hand-picked products
                      <s-text slot="details">Up to {MAX_PICKED} products.</s-text>
                    </s-choice>
                  </s-choice-list>

                  {targetType === "collection" && (
                    <s-stack direction="inline" gap="base" alignItems="center">
                      <s-text fontWeight="bold">{collection ? `${collection.title} · ${collection.count} products` : "No collection chosen yet"}</s-text>
                      <s-button onClick={pickCollection}>{collection ? "Change collection" : "Choose collection"}</s-button>
                    </s-stack>
                  )}

                  {targetType === "products" && (
                    <s-stack direction="block" gap="small-200">
                      <s-stack direction="inline" gap="base" alignItems="center">
                        <s-text fontWeight="bold">{products.length ? `${products.length} selected` : "No products chosen yet"}</s-text>
                        <s-button onClick={pickProducts}>{products.length ? "Change products" : "Choose products"}</s-button>
                      </s-stack>
                      {products.length > 0 && (
                        <s-text color="subdued" fontSize="small">
                          {products.slice(0, 5).map((p) => p.title).join(", ")}
                          {products.length > 5 ? ` and ${products.length - 5} more` : ""}
                        </s-text>
                      )}
                    </s-stack>
                  )}

                  <div>
                    <div className="bfw-row">
                      <s-text fontWeight="bold">Plan usage</s-text>
                      <s-text color="subdued">{productsCount} / {limit === Infinity ? "∞" : limit}</s-text>
                    </div>
                    {limit !== Infinity && (
                      <div className="bfw-meter">
                        <div style={{ width: `${Math.min(100, (productsCount / limit) * 100)}%`, height: "100%", background: overLimit ? "#B98900" : "#303030" }} />
                      </div>
                    )}
                    {overLimit ? (
                      <s-banner tone="warning">
                        This targets {productsCount} products, more than your {PLANS[plan].label} plan&apos;s {limit}. The first {limit}{" "}
                        get the badge and the rest show none. <s-link href="/app/plan">See plans</s-link>
                      </s-banner>
                    ) : (
                      <s-text color="subdued" fontSize="small">Fits the {PLANS[plan].label} plan.</s-text>
                    )}
                  </div>
                </s-stack>
              </s-section>
            )}

            {step === "schedule" && (
              <s-section>
                <s-stack direction="block" gap="base">
                  <s-choice-list
                    label="When should it start?"
                    name="startMode"
                    values={[startNow ? "now" : "date"]}
                    details={`Badges switch on and off by themselves. Times are in your store's timezone (${timezone}).`}
                    onChange={(e: CallbackEvent<"s-choice-list">) => setStartNow(e.currentTarget.values[0] !== "date")}
                  >
                    <s-choice value="now">Start now<s-text slot="details">Live as soon as you publish.</s-text></s-choice>
                    <s-choice value="date">Pick a start date<s-text slot="details">Schedule it ahead.</s-text></s-choice>
                  </s-choice-list>
                  {!startNow && (
                    <div className="bfw-dates">
                      <s-date-field
                        label="Start date"
                        value={startDate}
                        onChange={(e: CallbackEvent<"s-date-field">) => setStartDate(e.currentTarget.value)}
                        error={errors.startAt}
                      />
                      <s-select label="Start time" value={startTime} onChange={(e: CallbackEvent<"s-select">) => setStartTime(e.currentTarget.value)}>
                        {timeOptions(startTime).map((t) => <s-option key={t} value={t}>{t}</s-option>)}
                      </s-select>
                    </div>
                  )}
                  <s-switch
                    label="Set an end date"
                    checked={hasEndDate}
                    onChange={(e: CallbackEvent<"s-switch">) => setHasEndDate(Boolean(e.currentTarget.checked))}
                  />
                  {hasEndDate && (
                    <div className="bfw-dates">
                      <s-date-field
                        label="End date"
                        value={endDate}
                        onChange={(e: CallbackEvent<"s-date-field">) => setEndDate(e.currentTarget.value)}
                        error={errors.endAt}
                      />
                      <s-select label="End time" value={endTime} onChange={(e: CallbackEvent<"s-select">) => setEndTime(e.currentTarget.value)}>
                        {timeOptions(endTime).map((t) => <s-option key={t} value={t}>{t}</s-option>)}
                      </s-select>
                    </div>
                  )}
                  {plan === "free" && (
                    <s-text color="subdued" fontSize="small">
                      The Free plan shows one campaign at a time. If another campaign is live then, this one waits until it ends.
                    </s-text>
                  )}
                </s-stack>
              </s-section>
            )}

            {step === "review" && (
              <s-section>
                <s-heading>Review and publish</s-heading>
                <s-text color="subdued" fontSize="small">Check the details — you can jump back to any step above.</s-text>
                {!embedOn && (
                  <s-box paddingBlockStart="base">
                    <s-banner tone="warning" heading="Shoppers won't see this yet">
                      The BadgeFlow app embed is off in your theme. <s-link href="/app/setup">Turn it on</s-link>
                    </s-banner>
                  </s-box>
                )}
                <div className="bfw-summary">
                  {[
                    ["Badge", <span key="b" className="bfw-pill" style={{ background: badgeColor }}>{badgeText}</span>],
                    ["Position", `${positionLabel(position)} · ${size}%${mobilePosition !== position || mobileSize !== size ? ` (mobile: ${positionLabel(mobilePosition)} · ${mobileSize}%)` : ""}`],
                    ["Products", targetLabel],
                    ["Starts", startNow ? "Immediately, when published" : startInstant ? formatInZone(startInstant, timezone) : "Pick a start date"],
                    ["Ends", hasEndDate ? (endInstant ? formatInZone(endInstant, timezone) : "Pick an end date") : "No end date"],
                    ["Timezone", timezone],
                    ["Theme connection", embedOn ? "App embed is on" : "App embed is off"],
                    ["Plan check", `${productsCount} of ${limit === Infinity ? "∞" : limit} — ${PLANS[plan].label} plan${overLimit ? " (extra products show no badge)" : " ✓"}`],
                  ].map(([k, v]) => (
                    <div key={String(k)}>
                      <s-text color="subdued">{k}</s-text>
                      <span style={{ fontWeight: 550, textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                </div>
                {warning && <s-banner tone="warning">{warning}</s-banner>}
              </s-section>
            )}
          </div>

          <div className="bfw-col">{previewPanel}</div>
        </div>

        <div className="bfw-footer">
          {stepIndex === 0 ? (
            dirty ? (
              <s-button variant="tertiary" command="--show" commandFor="bfw-discard" disabled={busy}>Cancel</s-button>
            ) : (
              <s-button variant="tertiary" href="/app/campaigns" disabled={busy}>Cancel</s-button>
            )
          ) : (
            <s-button variant="tertiary" onClick={goBack} disabled={busy}>Back</s-button>
          )}
          <s-stack direction="inline" gap="small-200" alignItems="center">
            <span className="bfw-hint"><s-text color="subdued" fontSize="small">{next[step].hint}</s-text></span>
            <s-button onClick={() => send("draft")} disabled={busy} loading={busy && pendingIntent === "draft"}>Save as draft</s-button>
            {step === "review" ? (
              <s-button variant="primary" onClick={() => send("publish")} disabled={busy} loading={busy && pendingIntent === "publish"}>
                {next.review.label}
              </s-button>
            ) : (
              <s-button variant="primary" onClick={goNext} disabled={busy}>{next[step].label} ›</s-button>
            )}
          </s-stack>
        </div>
      </div>

      <s-modal id="bfw-discard" heading="Discard this campaign?">
        <s-paragraph>Your changes haven&apos;t been saved. Leave without saving?</s-paragraph>
        <s-button
          slot="primary-action"
          tone="critical"
          variant="primary"
          command="--hide"
          commandFor="bfw-discard"
          onClick={() => navigate("/app/campaigns")}
        >
          Discard
        </s-button>
        <s-button slot="secondary-actions" command="--hide" commandFor="bfw-discard">Keep editing</s-button>
      </s-modal>
    </s-page>
  );
}
