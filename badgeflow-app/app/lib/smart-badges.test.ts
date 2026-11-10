// Run with `npm test` (Node's built-in runner; Node strips the types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  bestDiscount,
  isNewProduct,
  parseTags,
  previewText,
  prioritize,
  qualifiesForSale,
  renderTemplate,
  shapeRadius,
  tagSearchQuery,
} from "./smart-badges.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-10T12:00:00Z");

test("bestDiscount: no compare-at price means no discount", () => {
  assert.equal(bestDiscount([{ price: 2000, compareAt: null }]), null);
  assert.equal(bestDiscount([{ price: 2000, compareAt: 2000 }]), null);
  assert.equal(bestDiscount([{ price: 2500, compareAt: 2000 }]), null);
  assert.equal(bestDiscount([]), null);
});

test("bestDiscount: rounds down so the badge never overstates", () => {
  assert.deepEqual(bestDiscount([{ price: 8000, compareAt: 10000 }]), { percent: 20, savingCents: 2000 });
  // 29.7% off → 29
  assert.deepEqual(bestDiscount([{ price: 7030, compareAt: 10000 }]), { percent: 29, savingCents: 2970 });
});

test("bestDiscount: biggest discount among buyable variants", () => {
  const variants = [
    { price: 9000, compareAt: 10000, available: true },
    { price: 5000, compareAt: 10000, available: false }, // sold out: ignored
    { price: 7000, compareAt: 10000, available: true },
  ];
  assert.deepEqual(bestDiscount(variants), { percent: 30, savingCents: 3000 });
});

test("bestDiscount: all sold out falls back to every variant", () => {
  const variants = [
    { price: 5000, compareAt: 10000, available: false },
    { price: 9000, compareAt: 10000, available: false },
  ];
  assert.deepEqual(bestDiscount(variants), { percent: 50, savingCents: 5000 });
});

test("qualifiesForSale: at least 1% and the campaign minimum", () => {
  assert.equal(qualifiesForSale(null, 0), false);
  assert.equal(qualifiesForSale({ percent: 0, savingCents: 1 }, 0), false);
  assert.equal(qualifiesForSale({ percent: 1, savingCents: 1 }, 0), true);
  assert.equal(qualifiesForSale({ percent: 9, savingCents: 1 }, 10), false);
  assert.equal(qualifiesForSale({ percent: 10, savingCents: 1 }, 10), true);
});

test("isNewProduct: published within N days", () => {
  assert.equal(isNewProduct(new Date(NOW - 3 * DAY).toISOString(), 14, NOW), true);
  assert.equal(isNewProduct(new Date(NOW - 14 * DAY).toISOString(), 14, NOW), true);
  assert.equal(isNewProduct(new Date(NOW - 15 * DAY).toISOString(), 14, NOW), false);
  assert.equal(isNewProduct(NOW - DAY, 1, NOW), true);
  assert.equal(isNewProduct(null, 14, NOW), false); // unpublished
  assert.equal(isNewProduct("not a date", 14, NOW), false);
  assert.equal(isNewProduct(NOW + DAY, 14, NOW), false); // scheduled to publish later
});

test("renderTemplate / previewText", () => {
  assert.equal(renderTemplate("-{discount}%", { percent: 30, amount: "$12" }), "-30%");
  assert.equal(renderTemplate("Save {AMOUNT}", { percent: 30, amount: "$12" }), "Save $12");
  assert.equal(previewText("sale", "-{discount}%"), "-25%");
  assert.equal(previewText("text", "-{discount}%"), "-{discount}%");
});

test("parseTags / tagSearchQuery", () => {
  assert.deepEqual(parseTags(" Summer, sale ,summer,, "), ["Summer", "sale"]);
  assert.equal(tagSearchQuery(["summer sale"]), "status:active AND (tag:'summer sale')");
  assert.equal(tagSearchQuery(["a", "it's"]), "status:active AND (tag:'a' OR tag:'it\\'s')");
});

test("shapeRadius: unknown shapes keep the original corners", () => {
  assert.equal(shapeRadius("pill"), "999px");
  assert.equal(shapeRadius("square"), "0");
  assert.equal(shapeRadius("rounded"), "4px");
  assert.equal(shapeRadius(undefined), "4px");
});

test("prioritize: limited slots go to products the badge will show on", () => {
  const products = [
    { handle: "a", onSale: false, publishedAt: new Date(NOW - 40 * DAY).toISOString() },
    { handle: "b", onSale: true, publishedAt: new Date(NOW - 2 * DAY).toISOString() },
    { handle: "c", onSale: false, publishedAt: new Date(NOW - 1 * DAY).toISOString() },
    { handle: "d", onSale: true, publishedAt: null },
  ];
  assert.deepEqual(prioritize(products, "sale", NOW), ["b", "d", "a", "c"]);
  assert.deepEqual(prioritize(products, "new", NOW, 14), ["c", "b", "a", "d"]);
  assert.deepEqual(prioritize(products, "text", NOW), ["a", "b", "c", "d"]);
});

// The storefront script repeats the rules in ES5; load it in a sandbox and
// check it agrees with the TypeScript version.
type Rules = {
  bestDiscount: typeof bestDiscount;
  isNewProduct: typeof isNewProduct;
  renderTemplate: (text: string, percent: number, amount: string) => string;
  radius: typeof shapeRadius;
  formatMoney: (cents: number, currency: string | null, moneyFormat?: string, locale?: string) => string;
  formatWithMoneyFormat: (cents: number, format: string) => string | null;
  resolveBadge: (c: object, product: object | null, now: number) => { text: string } | null;
};

function loadStorefrontRules(): Rules {
  const source = readFileSync(new URL("../../extensions/badgeflow-badges/assets/badgeflow.js", import.meta.url), "utf8");
  const window: Record<string, unknown> = {};
  const document = {
    readyState: "loading",
    addEventListener() {},
    getElementById: () => null,
    documentElement: { lang: "en" },
  };
  window.Intl = Intl;
  vm.runInNewContext(source, { window, document, Intl, console });
  return window.__badgeflowRules as Rules;
}

test("storefront script agrees with smart-badges.ts", () => {
  const js = loadStorefrontRules();
  const cases = [
    [{ price: 8000, compareAt: 10000 }],
    [{ price: 7030, compareAt: 10000 }],
    [
      { price: 9000, compareAt: 10000, available: true },
      { price: 5000, compareAt: 10000, available: false },
    ],
    [{ price: 2000, compareAt: null }],
    [],
  ];
  for (const variants of cases) assert.equal(JSON.stringify(js.bestDiscount(variants)), JSON.stringify(bestDiscount(variants)));
  for (const t of [NOW - 3 * DAY, NOW - 20 * DAY, null]) assert.equal(js.isNewProduct(t, 14, NOW), isNewProduct(t, 14, NOW));
  assert.equal(js.renderTemplate("-{discount}% / {amount}", 30, "$5"), "-30% / $5");
  for (const shape of ["pill", "square", "rounded", undefined]) assert.equal(js.radius(shape), shapeRadius(shape));
});

test("storefront script: money formatting", () => {
  const js = loadStorefrontRules();
  assert.equal(js.formatMoney(1000, "USD", undefined, "en"), "$10");
  assert.equal(js.formatMoney(1050, "USD", undefined, "en"), "$10.50");
  assert.equal(js.formatMoney(123456, null, "{{amount_with_comma_separator}} €"), "1.234,56 €");
  assert.equal(js.formatMoney(150000, null, "<span>${{amount_no_decimals}}</span>"), "$1,500");
  assert.equal(js.formatMoney(1000, null, ""), "10");
});

test("storefront script: resolveBadge only shows smart badges where they're true", () => {
  const js = loadStorefrontRules();
  const sale = { kind: "sale", text: "-{discount}%", minDiscount: 0 };
  const onSale = { available: true, publishedAt: null, variants: [{ price: 7000, compareAt: 10000, available: true }] };
  const fullPrice = { available: true, publishedAt: null, variants: [{ price: 7000, compareAt: null, available: true }] };
  assert.equal(js.resolveBadge(sale, onSale, NOW)?.text, "-30%");
  assert.equal(js.resolveBadge(sale, fullPrice, NOW), null);
  assert.equal(js.resolveBadge(sale, null, NOW), null); // data unavailable: no guess
  assert.equal(js.resolveBadge({ ...sale, minDiscount: 40 }, onSale, NOW), null);

  const fresh = { kind: "new", text: "NEW", newDays: 14 };
  assert.equal(js.resolveBadge(fresh, { ...fullPrice, publishedAt: new Date(NOW - DAY).toISOString() }, NOW)?.text, "NEW");
  assert.equal(js.resolveBadge(fresh, { ...fullPrice, publishedAt: new Date(NOW - 30 * DAY).toISOString() }, NOW), null);

  // Fixed-text badges are unchanged, data or not.
  assert.equal(js.resolveBadge({ text: "BLACK FRIDAY" }, null, NOW)?.text, "BLACK FRIDAY");
});
