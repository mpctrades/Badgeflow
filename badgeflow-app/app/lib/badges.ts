// Starter badge library. The brief calls for 100+ styles as SVG templates
// (a design task, not a code task) — this is a representative set so the
// campaign editor has something real to pick from while that library gets
// built out.
export const BADGE_CATEGORIES = [
  "All",
  "Sale",
  "New",
  "Holiday",
  "Stock",
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
  { id: "low-stock", label: "LOW STOCK", category: "Stock", color: "#E33C2B" },
  { id: "last-units", label: "LAST UNITS", category: "Stock", color: "#E33C2B" },
  { id: "free-ship", label: "FREE SHIP", category: "Shipping", color: "#161C2E" },
  { id: "bestseller", label: "BESTSELLER", category: "Shipping", color: "#2B5FD9" },
];

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
