// Starter badge library. The brief calls for 100+ styles as SVG templates
// (a design task, not a code task) — this is a representative set so the
// campaign editor has something real to pick from while that library gets
// built out.
export const BADGE_CATEGORIES = [
  "All",
  "Sale",
  "New",
  "Holiday",
  "Shipping",
] as const;

export type BadgeCategory = (typeof BADGE_CATEGORIES)[number];

export type BadgePreset = {
  id: string;
  label: string;
  category: Exclude<BadgeCategory, "All">;
  color: string;
};

export const BADGE_PRESETS: BadgePreset[] = [
  { id: "sale-30", label: "SALE -30%", category: "Sale", color: "#E33C2B" },
  { id: "sale-20", label: "SALE -20%", category: "Sale", color: "#E33C2B" },
  { id: "clearance", label: "CLEARANCE", category: "Sale", color: "#E33C2B" },
  { id: "new", label: "NEW", category: "New", color: "#12795F" },
  { id: "back-in-stock", label: "BACK IN STOCK", category: "New", color: "#12795F" },
  { id: "chuseok", label: "CHUSEOK", category: "Holiday", color: "#E29405" },
  { id: "bfcm", label: "BLACK FRIDAY", category: "Holiday", color: "#161C2E" },
  { id: "xmas", label: "HOLIDAY GIFT", category: "Holiday", color: "#2B5FD9" },
  { id: "free-ship", label: "FREE SHIP", category: "Shipping", color: "#161C2E" },
];

// Badges are fixed text: BadgeFlow never reads stock, sales or discounts, so
// the presets avoid scarcity and popularity claims ("LOW STOCK",
// "BESTSELLER"), and badges that make a factual claim carry a reminder that
// the merchant must only use them where the claim is true (App Store
// requirement 1.1.4).
export function claimWarning(presetId: string, text: string): string | null {
  const preset = BADGE_PRESETS.find((b) => b.id === presetId);
  const category = preset?.category;
  const upper = text.toUpperCase();
  if (category === "Sale" || /SALE|%|OFF\b|CLEARANCE/.test(upper)) {
    return "A sale badge only changes what shoppers see on the image — it doesn't create a Shopify discount. Set up the actual discount separately, and only show it while the offer is real.";
  }
  if (presetId === "back-in-stock" || /STOCK|LAST UNITS|SELLING FAST/.test(upper)) {
    return "BadgeFlow doesn't check inventory. Only put stock badges on products where they're true, and end the campaign when they stop being true.";
  }
  if (/BEST ?SELLER|POPULAR|TRENDING/.test(upper)) {
    return "BadgeFlow doesn't check sales. Only use this badge on products that really are your best sellers.";
  }
  return null;
}

export const POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "middle-center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type Position = (typeof POSITIONS)[number];

export function positionLabel(position: string): string {
  return position
    .split("-")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

export const TARGET_TYPES = [
  { value: "all", label: "All products" },
  { value: "collection", label: "Collection" },
  { value: "products", label: "Individual products" },
] as const;

// Text colour for a badge background. Must match textColor() in the
// storefront script (extensions/badgeflow-badges/assets/badgeflow.js) so
// admin previews look like the real badge.
export function badgeTextColor(hex: string): string {
  let h = String(hex || "").replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r + g + b)) return "#fff";
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1a1a1a" : "#fff";
}
