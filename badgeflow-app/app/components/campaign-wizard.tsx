import { useState } from "react";
import { useSubmit } from "react-router";
import type { CallbackEvent } from "@shopify/polaris-types";
import { BADGE_CATEGORIES, BADGE_PRESETS, POSITIONS, positionLabel } from "../lib/badges";
import { BRAND, BRAND_SOFT, PLANS, type PlanId } from "../lib/campaign";
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
const STEPS: { key: WizardStep; label: string }[] = [
  { key: "design", label: "Design" },
  { key: "products", label: "Products" },
  { key: "schedule", label: "Schedule" },
  { key: "review", label: "Review" },
];

function badgeById(id: string) {
  return BADGE_PRESETS.find((b) => b.id === id) ?? BADGE_PRESETS[0]!;
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

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
  const [category, setCategory] = useState<(typeof BADGE_CATEGORIES)[number]>("All");
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

  const selectedPreset = badgeById(selectedPresetId);
  const visiblePresets = category === "All" ? BADGE_PRESETS : BADGE_PRESETS.filter((b) => b.category === category);
  const isSaleFlavored = selectedPreset.category === "Sale";

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
  const willPublishNow = startNow;

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

  function goNext() {
    const order: WizardStep[] = ["design", "products", "schedule", "review"];
    const i = order.indexOf(step);
    if (i < order.length - 1) setStep(order[i + 1]!);
  }
  function goBack() {
    const order: WizardStep[] = ["design", "products", "schedule", "review"];
    const i = order.indexOf(step);
    if (i > 0) setStep(order[i - 1]!);
  }

  function saveDraft() {
    submit(buildFormData("draft"), { method: "post" });
  }
  function publish() {
    if (overLimit) return;
    submit(buildFormData("publish"), { method: "post" });
  }

  const currentPosition = device === "desktop" ? position : mobilePosition;
  const setCurrentPosition = device === "desktop" ? setPosition : setMobilePosition;
  const currentSize = device === "desktop" ? size : mobileSize;
  const setCurrentSize = device === "desktop" ? setSize : setMobileSize;

  function overlayStyle(pos: string, sz: number): React.CSSProperties {
    return {
      position: "absolute",
      ...(pos.startsWith("top") ? { top: "8%" } : {}),
      ...(pos.startsWith("bottom") ? { bottom: "8%" } : {}),
      ...(pos.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
      ...(pos.endsWith("left") ? { left: "8%" } : {}),
      ...(pos.endsWith("right") ? { right: "8%" } : {}),
      ...(pos.endsWith("center") ? { left: "50%", transform: pos.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" } : {}),
      background: badgeColor, color: "#fff", fontWeight: 700,
      padding: "4px 8px", borderRadius: 6, fontSize: 8 + sz / 2, whiteSpace: "nowrap",
    };
  }

  const previewFrame = (pos: string, sz: number, mobile: boolean) => (
    <div
      style={{
        position: "relative", overflow: "hidden", background: "#F3F2ED",
        border: "1px solid #E3E2DB", borderRadius: 10,
        aspectRatio: mobile ? "9/16" : "1/1",
        maxWidth: mobile ? 150 : "none",
        margin: mobile ? "0 auto" : undefined,
      }}
    >
      {previewProduct?.imageUrl ? (
        <img src={previewProduct.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      <span style={overlayStyle(pos, sz)}>{badgeText || "BADGE"}</span>
    </div>
  );

  return (
    <s-page heading={initial.editingId ? "Edit campaign" : "New campaign"}>
      <s-link slot="breadcrumb-actions" href="/app/campaigns">Campaigns</s-link>

      {/* step indicator */}
      <s-section>
        <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
          {STEPS.map((s, i) => {
            const active = s.key === step;
            const idx = STEPS.findIndex((x) => x.key === step);
            const done = i < idx;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStep(s.key)}
                style={{
                  flex: 1, textAlign: "left", padding: "10px 12px", borderRadius: 8,
                  border: active ? `2px solid ${BRAND}` : "1px solid #E3E2DB",
                  background: active ? BRAND_SOFT : done ? "#F6F6F5" : "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: active ? BRAND : "#6B7177" }}>
                  {i + 1}. {done ? "✓ " : ""}{s.label}
                </div>
              </button>
            );
          })}
        </div>
      </s-section>

      {step === "design" && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Campaign name"
              value={campaignName}
              onChange={(e: CallbackEvent<"s-text-field">) => setCampaignName(e.currentTarget.value)}
              placeholder={`${targetLabel} — ${badgeText || "badge"}`}
              details="For your reference only — shoppers never see this. Leave blank to use a generated name."
              maxLength={60}
            />

            <div>
              <s-text fontWeight="bold">Choose a template</s-text>
              <s-box paddingBlockStart="small-200" paddingBlockEnd="small-200">
                <s-stack direction="inline" gap="small-200">
                  {BADGE_CATEGORIES.map((cat) => (
                    <s-clickable-chip key={cat} color={category === cat ? "strong" : "subdued"} onClick={() => setCategory(cat)}>
                      {cat}
                    </s-clickable-chip>
                  ))}
                </s-stack>
              </s-box>
              <s-grid gridTemplateColumns="repeat(auto-fill, minmax(150px, 1fr))" gap="small-200">
                {visiblePresets.map((preset) => (
                  <s-clickable
                    key={preset.id}
                    padding="small-200"
                    borderWidth={selectedPresetId === preset.id ? "large" : "small"}
                    borderColor={selectedPresetId === preset.id ? "strong" : "base"}
                    borderRadius="base"
                    accessibilityLabel={`Use ${preset.label} badge`}
                    onClick={() => {
                      setSelectedPresetId(preset.id);
                      setBadgeText(preset.label);
                      setBadgeColor(preset.color);
                    }}
                  >
                    <span style={{ display: "inline-block", backgroundColor: preset.color, color: "#fff", fontWeight: 700, borderRadius: 6, padding: "4px 8px", fontSize: 12 }}>
                      {preset.label}
                    </span>
                  </s-clickable>
                ))}
              </s-grid>
            </div>

            {isSaleFlavored && (
              <div style={{ background: "#FBF0DD", border: "1px solid #E0A643", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "#8A6420" }}>
                A sale badge only changes what shoppers see on the image — it doesn&apos;t create a Shopify discount. Set up the actual discount separately if the badge references one.
              </div>
            )}

            <s-grid gridTemplateColumns="220px 1fr" gap="large">
              <div>
                {previewFrame(currentPosition, currentSize, device === "mobile")}
                <s-box paddingBlockStart="small-200">
                  <s-stack direction="inline" gap="small-100">
                    <s-clickable-chip color={device === "desktop" ? "strong" : "subdued"} onClick={() => setDevice("desktop")}>Desktop</s-clickable-chip>
                    <s-clickable-chip color={device === "mobile" ? "strong" : "subdued"} onClick={() => setDevice("mobile")}>Mobile</s-clickable-chip>
                  </s-stack>
                </s-box>
              </div>

              <s-stack direction="block" gap="base">
                <s-text-field
                  label="Badge text"
                  value={badgeText}
                  onChange={(e: CallbackEvent<"s-text-field">) => setBadgeText(e.currentTarget.value)}
                  maxLength={22}
                  error={errors.badgeText}
                />
                <div>
                  <s-text color="subdued" fontSize="small">Color</s-text>
                  <s-box paddingBlockStart="small-100">
                    <s-stack direction="inline" gap="small-200">
                      {["#E33C2B", "#12795F", "#E29405", "#161C2E", "#2B5FD9"].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setBadgeColor(c)}
                          aria-label={c}
                          style={{
                            width: 26, height: 26, borderRadius: "50%", background: c,
                            border: badgeColor === c ? `3px solid ${BRAND}` : "1px solid #E3E2DB",
                            padding: 0, cursor: "pointer",
                          }}
                        />
                      ))}
                    </s-stack>
                  </s-box>
                </div>
                <div>
                  <s-text color="subdued" fontSize="small">
                    Position ({device === "desktop" ? "desktop" : "mobile"})
                  </s-text>
                  <s-box paddingBlockStart="small-100">
                    <s-grid gridTemplateColumns="repeat(3, 30px)" gap="small-100">
                      {POSITIONS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setCurrentPosition(p)}
                          aria-label={positionLabel(p)}
                          style={{
                            width: 30, height: 30, borderRadius: 5,
                            border: currentPosition === p ? `2px solid ${BRAND}` : "1px solid #E3E2DB",
                            background: currentPosition === p ? BRAND : "transparent",
                            cursor: "pointer", padding: 0,
                          }}
                        />
                      ))}
                    </s-grid>
                  </s-box>
                </div>
                <s-number-field
                  label={`Size — ${device} (% of image width)`}
                  value={String(currentSize)}
                  onChange={(e: CallbackEvent<"s-number-field">) => setCurrentSize(Number(e.currentTarget.value) || 12)}
                  min={8}
                  max={24}
                />
              </s-stack>
            </s-grid>

            <s-stack direction="inline" justifyContent="end" gap="small-200">
              <s-button variant="secondary" onClick={saveDraft}>Save draft</s-button>
              <s-button variant="primary" onClick={goNext}>Continue</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {step === "products" && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-select
              label="Select by"
              value={targetType}
              onChange={(e: CallbackEvent<"s-select">) => setTargetType(e.currentTarget.value)}
            >
              <s-option value="all">All products</s-option>
              <s-option value="collection">Collection</s-option>
              <s-option value="products">Individual products</s-option>
            </s-select>

            {targetType === "collection" && (
              collections.length === 0 ? (
                <s-text color="subdued" fontSize="small">No collections found in this store yet.</s-text>
              ) : (
                <s-stack direction="block" gap="small-100">
                  {collections.map((c) => (
                    <s-clickable
                      key={c.id}
                      padding="small-200"
                      borderWidth={collectionId === c.id ? "large" : "small"}
                      borderColor={collectionId === c.id ? "strong" : "base"}
                      borderRadius="base"
                      onClick={() => setCollectionId(c.id)}
                    >
                      <s-text fontWeight={collectionId === c.id ? "bold" : "base"}>{c.title} — {c.productsCount} products</s-text>
                    </s-clickable>
                  ))}
                </s-stack>
              )
            )}

            {targetType === "products" && (
              <s-text-field
                label="Product handles (comma-separated)"
                value={productHandles}
                onChange={(e: CallbackEvent<"s-text-field">) => setProductHandles(e.currentTarget.value)}
                placeholder="e.g. hydrating-serum, ginseng-cream"
                error={errors.targetValue}
              />
            )}

            {sampleThumbs.length > 0 && (
              <div>
                <s-text color="subdued" fontSize="small">Sample product images from your store</s-text>
                <s-box paddingBlockStart="small-100">
                  <s-stack direction="inline" gap="small-200">
                    {sampleThumbs.slice(0, 4).map((p) => (
                      <div key={p.id} style={{ width: 48, height: 48, borderRadius: 6, overflow: "hidden", background: "#F3F2ED", flex: "0 0 auto" }}>
                        {p.imageUrl && <img src={p.imageUrl} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                      </div>
                    ))}
                  </s-stack>
                </s-box>
              </div>
            )}

            <div style={{ padding: "10px 12px", borderRadius: 8, background: overLimit ? "#FBE9E7" : "#E4EFE8", color: overLimit ? "#C1392B" : "#1F5D3D", fontWeight: 700, fontSize: 13.5 }}>
              {overLimit
                ? `${productsCount} products is over your ${PLANS[plan].label} plan's ${limit}-product limit.`
                : `${productsCount} of ${limit === Infinity ? "∞" : limit} products used on the ${PLANS[plan].label} plan.`}
            </div>

            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-button variant="secondary" onClick={goBack}>Back</s-button>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="secondary" onClick={saveDraft}>Save draft</s-button>
                <s-button variant="primary" onClick={goNext}>Continue</s-button>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {step === "schedule" && (
        <s-section>
          <s-stack direction="block" gap="base">
            <s-switch
              label="Start now"
              checked={startNow}
              onChange={(e: CallbackEvent<"s-switch">) => setStartNow(Boolean(e.currentTarget.checked))}
            />
            {!startNow && (
              <s-date-field
                label="Start"
                value={startAt}
                onChange={(e: CallbackEvent<"s-date-field">) => setStartAt(e.currentTarget.value)}
                error={errors.startAt}
              />
            )}
            <s-switch
              label="No end date"
              checked={!hasEndDate}
              onChange={(e: CallbackEvent<"s-switch">) => setHasEndDate(!e.currentTarget.checked)}
            />
            {hasEndDate && (
              <s-date-field
                label="End"
                value={endAt}
                onChange={(e: CallbackEvent<"s-date-field">) => setEndAt(e.currentTarget.value)}
                error={errors.endAt}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#6B7177" }}>
              Times are in your store&apos;s timezone.
            </div>

            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-button variant="secondary" onClick={goBack}>Back</s-button>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="secondary" onClick={saveDraft}>Save draft</s-button>
                <s-button variant="primary" onClick={goNext}>Continue</s-button>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {step === "review" && (
        <s-section>
          <s-stack direction="block" gap="base">
            {!embedConfirmed && (
              <div style={{ background: "#FBF0DD", border: "1px solid #E0A643", borderRadius: 8, padding: 12, fontSize: 13, color: "#8A6420" }}>
                <b>Storefront won&apos;t show this yet.</b> The app embed is still off.{" "}
                <s-link href="/app/setup">Go to setup</s-link>
              </div>
            )}

            <s-grid gridTemplateColumns="220px 1fr" gap="large">
              {previewFrame(position, size, false)}
              <s-stack direction="block" gap="none">
                {[
                  ["Badge", badgeText],
                  ["Audience", targetLabel],
                  ["Starts", startNow ? "Immediately, when scheduled" : new Date(startAt).toLocaleString()],
                  ["Ends", hasEndDate ? new Date(endAt).toLocaleString() : "No end date"],
                  ["Timezone", timezone],
                  ["Theme connection", embedConfirmed ? "Confirmed by you" : "Not confirmed yet"],
                  ["Plan limit", `${productsCount} of ${limit === Infinity ? "∞" : limit} — ${PLANS[plan].label} plan${productsCount <= limit ? " ✓" : ""}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #ECEEEC" }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "#6B7177" }}>{k}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 700 }}>{v}</span>
                  </div>
                ))}
              </s-stack>
            </s-grid>

            {isSaleFlavored && (
              <div style={{ background: "#FBF0DD", border: "1px solid #E0A643", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "#8A6420" }}>
                Reminder: this badge doesn&apos;t create a Shopify discount on its own.
              </div>
            )}

            {overLimit && (
              <div style={{ background: "#FBE9E7", border: "1px solid #C1392B", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "#C1392B" }}>
                {productsCount} products needs more room than the {PLANS[plan].label} plan&apos;s {limit}-product limit.{" "}
                <s-link href="/app/plan">See plans</s-link> or reduce the audience in Products.
              </div>
            )}

            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-button variant="secondary" onClick={goBack}>Back</s-button>
              <s-stack direction="inline" gap="small-200">
                <s-button variant="secondary" onClick={saveDraft}>Save draft</s-button>
                <s-button variant="primary" onClick={publish} disabled={overLimit}>
                  {willPublishNow ? "Publish now" : "Schedule campaign"}
                </s-button>
              </s-stack>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}
