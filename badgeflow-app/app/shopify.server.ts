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

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = { ...shopify.authenticate, admin: authenticateAdmin };
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
