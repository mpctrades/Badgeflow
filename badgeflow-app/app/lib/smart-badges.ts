// Smart badges: badges whose text or visibility comes from the product
// itself instead of being typed once for every product.
//
//  - "sale": shown only on products that are really discounted (a variant's
//    compare-at price is above its price); the text can include the real
//    discount ("-{discount}%") or saving ("Save {amount}").
//  - "new":  shown only on products published in the last N days.
//
// The storefront script (storefront/badgeflow.js, minified into extensions/badgeflow-badges/assets/)
// repeats bestDiscount(), isNewProduct() and renderTemplate() in plain ES5 —
// keep the two in step (both are covered by tests).
//
// No imports here, so this file runs under `node --test` as-is.

export const BADGE_KINDS = ["text", "sale", "new"] as const;
export type BadgeKind = (typeof BADGE_KINDS)[number];

export function isBadgeKind(v: string): v is BadgeKind {
  return (BADGE_KINDS as readonly string[]).includes(v);
}

export const SHAPES = [
  { value: "rounded", label: "Rounded" },
  { value: "pill", label: "Pill" },
  { value: "square", label: "Square" },
] as const;
export type BadgeShape = (typeof SHAPES)[number]["value"];

export function isShape(v: string): v is BadgeShape {
  return SHAPES.some((s) => s.value === v);
}

// Must match radius() in badgeflow.js.
export function shapeRadius(shape: string | null | undefined): string {
  if (shape === "pill") return "999px";
  if (shape === "square") return "0";
  return "4px";
}

export const NEW_DAYS_DEFAULT = 14;
export const NEW_DAYS_MIN = 1;
export const NEW_DAYS_MAX = 90;
export const MIN_DISCOUNT_MAX = 90;

export const SALE_TEMPLATES = ["-{discount}%", "SAVE {discount}%", "Save {amount}", "SALE"] as const;
export const NEW_TEMPLATES = ["NEW", "JUST IN", "NEW ARRIVAL"] as const;

export const PLACEHOLDER = /\{(discount|amount)\}/i;

export const TAGS_MAX = 10;
const TAG_LENGTH_MAX = 40;

// "Summer, sale ,summer" → ["Summer", "sale"]. Case-insensitive de-dupe,
// keeps the merchant's spelling of the first occurrence.
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim().slice(0, TAG_LENGTH_MAX);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// Admin API product search for "has any of these tags". Values are quoted so
// tags with spaces work; quotes and backslashes inside a tag are escaped.
export function tagSearchQuery(tags: string[]): string {
  const terms = tags.map((t) => `tag:'${t.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  return `status:active AND (${terms.join(" OR ")})`;
}

export type VariantPrice = { price: number; compareAt: number | null | undefined; available?: boolean };
export type Discount = { percent: number; savingCents: number };

// The discount a badge may claim for a product: the biggest one among the
// variants a shopper can buy (all variants when none are in stock, so a
// sold-out product still reads correctly if the merchant shows sold-out
// products). Prices are in cents. The percentage is rounded DOWN so a badge
// never overstates the discount (29.6% off shows "-29%").
export function bestDiscount(variants: VariantPrice[]): Discount | null {
  const buyable = variants.some((v) => v.available !== false) ? variants.filter((v) => v.available !== false) : variants;
  let best: Discount | null = null;
  for (const v of buyable) {
    const price = Number(v.price);
    const compare = Number(v.compareAt);
    if (!Number.isFinite(price) || !Number.isFinite(compare) || compare <= 0 || compare <= price) continue;
    const percent = Math.floor(((compare - price) * 100) / compare);
    const savingCents = compare - price;
    if (!best || percent > best.percent || (percent === best.percent && savingCents > best.savingCents)) {
      best = { percent, savingCents };
    }
  }
  return best;
}

// Whether a sale badge shows for this discount. At least 1% off, and at least
// the campaign's minimum.
export function qualifiesForSale(discount: Discount | null, minDiscount: number): discount is Discount {
  return !!discount && discount.percent >= Math.max(1, minDiscount);
}

export function isNewProduct(publishedAt: string | number | null | undefined, days: number, now: number = Date.now()): boolean {
  if (publishedAt === null || publishedAt === undefined || publishedAt === "") return false;
  const t = typeof publishedAt === "number" ? publishedAt : Date.parse(publishedAt);
  if (!Number.isFinite(t) || t > now) return false;
  return now - t <= days * 24 * 60 * 60 * 1000;
}

export function renderTemplate(text: string, values: { percent: number; amount: string }): string {
  return text.replace(/\{discount\}/gi, String(values.percent)).replace(/\{amount\}/gi, values.amount);
}

// What admin previews show for a badge: smart sale text with example values.
// Name used when the merchant leaves "Campaign name" blank. Sale badge text
// holds {discount}/{amount} placeholders, which read badly in a list.
export function defaultCampaignName(target: string, kind: string, text: string, newDays: number): string {
  if (kind === "sale") return `${target} — automatic sale`;
  if (kind === "new") return `${target} — ${text || "NEW"} (new for ${newDays} days)`;
  return `${target} — ${text || "badge"}`;
}

export function previewText(kind: string, text: string, sample: { percent: number; amount: string } = { percent: 25, amount: "$10" }): string {
  return kind === "sale" ? renderTemplate(text, sample) : text;
}

export function kindLabel(kind: string): string | null {
  if (kind === "sale") return "Auto sale";
  if (kind === "new") return "Auto new";
  return null;
}

// A short explanation of when a smart badge shows, for summaries.
export function kindRule(kind: string, opts: { minDiscount: number; newDays: number }): string | null {
  if (kind === "sale") {
    return opts.minDiscount > 1
      ? `Only on products at least ${opts.minDiscount}% off (compare-at price above the price)`
      : "Only on products with a compare-at price above the price";
  }
  if (kind === "new") return `Only on products published in the last ${opts.newDays} day${opts.newDays === 1 ? "" : "s"}`;
  return null;
}

export type CandidateProduct = { handle: string; onSale: boolean; publishedAt: string | null };

// With a product limit (Free plan), which targeted products should get the
// limited slots: for a sale badge the discounted ones, for a "new" badge the
// newest. Order is otherwise kept (Shopify's order: title, collection order).
export function prioritize(products: CandidateProduct[], kind: string, now: number = Date.now(), newDays = NEW_DAYS_DEFAULT): string[] {
  if (kind === "sale") {
    return [...products.filter((p) => p.onSale), ...products.filter((p) => !p.onSale)].map((p) => p.handle);
  }
  if (kind === "new") {
    const fresh = products
      .filter((p) => isNewProduct(p.publishedAt, newDays, now))
      .sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
    const rest = products.filter((p) => !fresh.includes(p));
    return [...fresh, ...rest].map((p) => p.handle);
  }
  return products.map((p) => p.handle);
}
