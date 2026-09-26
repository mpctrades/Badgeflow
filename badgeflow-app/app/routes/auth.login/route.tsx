import { AppProvider } from "@shopify/shopify-app-react-router/react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

// App Store requirement 2.3.1: BadgeFlow never asks merchants to type their
// myshopify.com domain. Shopify sends the shop along when the app is opened
// from the admin or installed from the App Store; without it we only explain
// where to open the app from.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop")) return { error: null };

  // Redirects into Shopify's auth flow for a valid shop.
  const errors = loginErrorMessage(await login(request));
  return { error: errors.shop ?? null };
};

export default function Auth() {
  const { error } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Open BadgeFlow from Shopify">
          <s-stack direction="block" gap="base">
            {error && <s-banner tone="critical">{error}</s-banner>}
            <s-paragraph>
              BadgeFlow runs inside your Shopify admin. Install it from the Shopify App Store, then open it from{" "}
              <s-text fontWeight="bold">Apps → BadgeFlow</s-text> in your admin.
            </s-paragraph>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}
