import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { forgetPlan } from "../lib/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Shopify cancels app subscriptions on uninstall, so a reinstall must start
  // on Free and go through charge approval again. Campaigns are kept until
  // shop/redact in case the merchant comes back.
  await db.shopSettings.updateMany({ where: { shop }, data: { plan: "free" } });
  forgetPlan(shop);

  return new Response();
};
