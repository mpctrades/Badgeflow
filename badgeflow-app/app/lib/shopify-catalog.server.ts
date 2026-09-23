// Thin helpers around the Admin API for real store data — collections to
// target campaigns at, and a sample product for the live badge preview.
// Falls back to placeholders if the store has neither (e.g. an empty dev store).

type AdminGraphqlClient = { graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response> };

export type StoreCollection = { id: string; title: string; handle: string; productsCount: number };

export async function fetchCollections(admin: AdminGraphqlClient, first = 8): Promise<StoreCollection[]> {
  const response = await admin.graphql(
    `#graphql
      query BadgeFlowCollections($first: Int!) {
        collections(first: $first, sortKey: TITLE) {
          edges {
            node {
              id
              title
              handle
              productsCount { count }
            }
          }
        }
      }`,
    { variables: { first } },
  );
  const json = await response.json();
  type Edge = { node: { id: string; title: string; handle: string; productsCount?: { count: number } } };
  const edges: Edge[] = json?.data?.collections?.edges ?? [];
  return edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    handle: e.node.handle,
    productsCount: e.node.productsCount?.count ?? 0,
  }));
}

export type PreviewProduct = { id: string; title: string; price: string; currency: string; imageUrl: string | null };

export async function fetchPreviewProducts(admin: AdminGraphqlClient, first = 3): Promise<PreviewProduct[]> {
  const response = await admin.graphql(
    `#graphql
      query BadgeFlowPreviewProducts($first: Int!) {
        products(first: $first, sortKey: TITLE) {
          edges {
            node {
              id
              title
              featuredImage { url(transform: {maxWidth: 300, maxHeight: 300}) }
              priceRangeV2 { minVariantPrice { amount currencyCode } }
            }
          }
        }
      }`,
    { variables: { first } },
  );
  const json = await response.json();
  type Edge = {
    node: {
      id: string;
      title: string;
      featuredImage?: { url: string };
      priceRangeV2?: { minVariantPrice?: { amount: string; currencyCode: string } };
    };
  };
  const edges: Edge[] = json?.data?.products?.edges ?? [];
  return edges.map((e) => ({
    id: e.node.id,
    title: e.node.title,
    price: Number(e.node.priceRangeV2?.minVariantPrice?.amount ?? 0).toFixed(2),
    currency: e.node.priceRangeV2?.minVariantPrice?.currencyCode ?? "USD",
    imageUrl: e.node.featuredImage?.url ?? null,
  }));
}

export async function fetchTotalProductCount(admin: AdminGraphqlClient): Promise<number> {
  const response = await admin.graphql(`#graphql
    query BadgeFlowTotalProducts { productsCount { count } }`);
  const json = await response.json();
  return json?.data?.productsCount?.count ?? 0;
}

export type ShopInfo = { name: string; ianaTimezone: string };

export async function fetchShopInfo(admin: AdminGraphqlClient): Promise<ShopInfo> {
  const response = await admin.graphql(`#graphql
    query BadgeFlowShopInfo { shop { name ianaTimezone } }`);
  const json = await response.json();
  return {
    name: json?.data?.shop?.name ?? "Your store",
    ianaTimezone: json?.data?.shop?.ianaTimezone ?? "UTC",
  };
}

// Real per-product metering: resolves a campaign's target into the set of
// product IDs it actually covers, so usage across campaigns can be deduped
// (a product in two campaigns still counts once).
export async function fetchProductIdsForTarget(
  admin: AdminGraphqlClient,
  target: { targetType: string; targetRef: string },
): Promise<string[]> {
  if (target.targetType === "products") {
    return target.targetRef.split(",").map((h) => h.trim()).filter(Boolean);
  }

  if (target.targetType === "collection" && target.targetRef) {
    const response = await admin.graphql(
      `#graphql
        query BadgeFlowCollectionProductIds($id: ID!) {
          collection(id: $id) {
            products(first: 250) { edges { node { id } } }
          }
        }`,
      { variables: { id: target.targetRef } },
    );
    const json = await response.json();
    type Edge = { node: { id: string } };
    const edges: Edge[] = json?.data?.collection?.products?.edges ?? [];
    return edges.map((e) => e.node.id);
  }

  // "all" — every product in the store.
  const response = await admin.graphql(`#graphql
    query BadgeFlowAllProductIds { products(first: 250) { edges { node { id } } } }`);
  const json = await response.json();
  type Edge = { node: { id: string } };
  const edges: Edge[] = json?.data?.products?.edges ?? [];
  return edges.map((e) => e.node.id);
}
