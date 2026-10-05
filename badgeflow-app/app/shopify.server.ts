import { createHmac, timingSafeEqual } from "node:crypto";
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { syncStorefront } from "./lib/storefront-sync.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    // The storefront reads badges from a metafield owned by the app
    // installation, and a reinstall is a new installation. Republish right
    // away so kept campaigns show again without the merchant saving anything.
    afterAuth: async ({ admin, session }) => {
      await syncStorefront(admin, session.shop);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// @shopify/shopify-api's host check decodes any base64-looking `host` and
// passes it to `new URL()` unguarded, so a forged value (App Store review
// probes send these) crashes the request with a 500 "Invalid URL" instead of
// being rejected. Answer those with a 400 before the library sees them.
const BASE64 = /^[0-9a-zA-Z+/]+={0,2}$/;

function rejectMalformedHost(request: Request) {
  const host = new URL(request.url).searchParams.get("host");
  if (!host || !BASE64.test(host)) return;
  try {
    new URL(`https://${atob(host)}`);
  } catch {
    throw new Response("Invalid host parameter", { status: 400 });
  }
}

const authenticateAdmin = ((request: Request) => {
  rejectMalformedHost(request);
  return shopify.authenticate.admin(request);
}) as typeof shopify.authenticate.admin;

// With expiring offline tokens, authenticate.webhook refreshes a stored token
// that has expired before handing it over. After an uninstall (or a closed
// store) that refresh can never succeed, so the library answers a valid
// webhook with a bare 500 and Shopify keeps retrying app/uninstalled and
// shop/redact. None of our webhook handlers call the Admin API, so once the
// HMAC checks out, drop the dead session and authenticate again without it.
//
// The HMAC covers the body but not the X-Shopify-Shop-Domain header, so a
// replayed webhook could carry another shop's domain in the header. Only
// trust the shop when the signed body names the same one (shop_domain for
// the compliance topics, myshopify_domain for app/uninstalled).
async function verifiedWebhookShop(request: Request): Promise<string | null> {
  const hmac = request.headers.get("X-Shopify-Hmac-Sha256") ?? "";
  const shop = request.headers.get("X-Shopify-Shop-Domain") ?? "";
  const body = Buffer.from(await request.arrayBuffer());
  const digest = createHmac("sha256", process.env.SHOPIFY_API_SECRET || "").update(body).digest();
  const given = Buffer.from(hmac, "base64");
  if (!shop || given.length !== digest.length || !timingSafeEqual(given, digest)) return null;

  let payload: { shop_domain?: unknown; myshopify_domain?: unknown };
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  const signedShop = payload?.shop_domain ?? payload?.myshopify_domain;
  return typeof signedShop === "string" && signedShop === shop ? shop : null;
}

const authenticateWebhook = (async (request: Request) => {
  const retry = request.clone();
  const recheck = request.clone();
  try {
    return await shopify.authenticate.webhook(request);
  } catch (error) {
    // 4xx Responses are the library rejecting the request itself (bad HMAC,
    // wrong method, missing headers); pass those straight through.
    if (error instanceof Response && error.status < 500) throw error;
    const shop = await verifiedWebhookShop(recheck);
    if (!shop) throw error;
    console.warn(`[BadgeFlow] offline token refresh failed for ${shop}; dropping its session`);
    await prisma.session.deleteMany({ where: { shop, isOnline: false } });
    return shopify.authenticate.webhook(retry);
  }
}) as typeof shopify.authenticate.webhook;

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = { ...shopify.authenticate, admin: authenticateAdmin, webhook: authenticateWebhook };
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
