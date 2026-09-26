// Thin helpers around the Admin API for real store data — the targets a
// campaign points at, and sample products for badge previews. Every helper
// falls back to an empty result (and logs) when the Admin API fails or
// throttles, so a hiccup degrades a preview instead of breaking the page.

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

async function query<T>(
  admin: AdminGraphqlClient,
  name: string,
  gql: string,
  variables: Record<string, unknown> | undefined,
  pick: (data: any) => T, // eslint-disable-line @typescript-eslint/no-explicit-any
  fallback: T,
): Promise<T> {
  try {
    const response = await admin.graphql(gql, variables ? { variables } : undefined);
    const body = await response.json();
    if (body?.errors) throw new Error(JSON.stringify(body.errors));
    return pick(body?.data) ?? fallback;
  } catch (error) {
    // Auth redirects are Responses and must reach the framework.
    if (error instanceof Response) throw error;
    console.error(`[BadgeFlow] ${name} failed:`, error);
    return fallback;
  }
}

export type StoreCollection = { id: string; title: string; productsCount: number };

export async function fetchCollection(admin: AdminGraphqlClient, id: string): Promise<StoreCollection | null> {
  if (!id.startsWith("gid://")) return null;
  return query(
    admin,
    "BadgeFlowCollection",
    `#graphql
      query BadgeFlowCollection($id: ID!) {
        collection(id: $id) { id title productsCount { count } }
      }`,
    { id },
    (data) =>
      data?.collection
        ? { id: data.collection.id, title: data.collection.title, productsCount: data.collection.productsCount?.count ?? 0 }
        : null,
    null,
  );
}

export type PickedProduct = { id: string; title: string; handle: string };

// Titles for hand-picked products (stored as GIDs; legacy campaigns stored
// handles, which are shown as-is).
export async function fetchPickedProducts(admin: AdminGraphqlClient, targetRef: string): Promise<PickedProduct[]> {
  const entries = targetRef.split(",").map((e) => e.trim()).filter(Boolean);
  const ids = entries.filter((e) => e.startsWith("gid://")).slice(0, 250);
  const legacy = entries.filter((e) => !e.startsWith("gid://")).map((h) => ({ id: h, title: h, handle: h }));
  if (!ids.length) return legacy;
  const found = await query(
    admin,
    "BadgeFlowPickedProducts",
    `#graphql
      query BadgeFlowPickedProducts($ids: [ID!]!) {
        nodes(ids: $ids) { ... on Product { id title handle } }
      }`,
    { ids },
    (data) => ((data?.nodes ?? []) as (PickedProduct | null)[]).filter((n): n is PickedProduct => !!n?.id),
    [] as PickedProduct[],
  );
  return [...found, ...legacy];
}

export type PreviewProduct = { id: string; handle: string; title: string; price: string; currency: string; imageUrl: string | null };

type ProductNode = {
  id: string;
  handle: string;
  title: string;
  featuredImage?: { url: string } | null;
  priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string } };
};

function toPreview(n: ProductNode): PreviewProduct {
  return {
    id: n.id,
    handle: n.handle,
    title: n.title,
    price: Number(n.priceRangeV2?.minVariantPrice?.amount ?? 0).toFixed(2),
    currency: n.priceRangeV2?.minVariantPrice?.currencyCode ?? "USD",
    imageUrl: n.featuredImage?.url ?? null,
  };
}

const PREVIEW_FIELDS = `id handle title featuredImage { url(transform: {maxWidth: 300, maxHeight: 300}) } priceRangeV2 { minVariantPrice { amount currencyCode } }`;

// `handles` narrows the preview to the products a campaign really targets.
export async function fetchPreviewProducts(admin: AdminGraphqlClient, first = 3, handles?: string[]): Promise<PreviewProduct[]> {
  if (handles && !handles.length) return [];
  const search = handles ? handles.slice(0, 20).map((h) => `handle:${JSON.stringify(h)}`).join(" OR ") : null;
  return query(
    admin,
    "BadgeFlowPreviewProducts",
    `#graphql
      query BadgeFlowPreviewProducts($first: Int!, $query: String) {
        products(first: $first, sortKey: TITLE, query: $query) { nodes { ${PREVIEW_FIELDS} } }
      }`,
    { first, query: search },
    (data) => ((data?.products?.nodes ?? []) as ProductNode[]).map(toPreview),
    [] as PreviewProduct[],
  );
}

export async function fetchTotalProductCount(admin: AdminGraphqlClient): Promise<number> {
  return query(
    admin,
    "BadgeFlowTotalProducts",
    `#graphql
      query BadgeFlowTotalProducts { productsCount { count } }`,
    undefined,
    (data) => data?.productsCount?.count ?? 0,
    0,
  );
}

export type ShopInfo = { name: string; ianaTimezone: string };

export async function fetchShopInfo(admin: AdminGraphqlClient): Promise<ShopInfo> {
  return query(
    admin,
    "BadgeFlowShopInfo",
    `#graphql
      query BadgeFlowShopInfo { shop { name ianaTimezone } }`,
    undefined,
    (data) => ({ name: data?.shop?.name ?? "Your store", ianaTimezone: data?.shop?.ianaTimezone ?? "UTC" }),
    { name: "Your store", ianaTimezone: "UTC" },
  );
}

export function formatPrice(amount: string, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
