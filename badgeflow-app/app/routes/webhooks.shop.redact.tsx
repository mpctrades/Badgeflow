import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook, fired ~48h after uninstall. Delete any remaining
// shop-scoped data (sessions, campaigns, settings) so nothing outlives the
// merchant's relationship with the app.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.$transaction([
    db.session.deleteMany({ where: { shop } }),
    db.campaign.deleteMany({ where: { shop } }),
    db.shopSettings.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
