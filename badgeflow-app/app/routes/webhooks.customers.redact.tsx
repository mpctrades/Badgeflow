import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook. BadgeFlow never stores customer PII (read_products /
// read_themes scopes only), so there is no customer data to redact — we still
// must acknowledge the request per Shopify's compliance requirements.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  return new Response();
};
