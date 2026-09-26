import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = (payload as { current?: unknown }).current;
  if (session && Array.isArray(current)) {
    await db.session.update({
      where: { id: session.id },
      data: { scope: current.map(String).join(",") },
    });
  }
  return new Response();
};
