// How many active products carry any of the given tags — for the campaign
// wizard's plan-usage meter. Returns { count: null } if Shopify can't answer.
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { parseTags, TAGS_MAX, tagSearchQuery } from "../lib/smart-badges";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const tags = parseTags(new URL(request.url).searchParams.get("tags") ?? "").slice(0, TAGS_MAX);
  if (!tags.length) return { count: 0 };
  try {
    const response = await admin.graphql(
      `#graphql
        query BadgeFlowTagCount($query: String!) { productsCount(query: $query, limit: null) { count } }`,
      { variables: { query: tagSearchQuery(tags) } },
    );
    const body = await response.json();
    return { count: (body?.data?.productsCount?.count as number | undefined) ?? null };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("[BadgeFlow] tag count failed:", error);
    return { count: null };
  }
};
