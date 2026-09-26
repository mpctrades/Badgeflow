import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { isRouteErrorResponse, Outlet, useLoaderData, useRouteError, useRouteLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { ToastProvider } from "../components/toast";
import { refreshPlan } from "../lib/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Keeps ShopSettings.plan in step with Shopify App Pricing (cached ~5 min).
  await refreshPlan(admin, session.shop);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/campaigns">Campaigns</s-link>
        <s-link href="/app/plan">Plan &amp; billing</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/setup">Store setup</s-link>
      </s-app-nav>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their
// headers are included in the response. Anything else (an Admin API outage,
// a bug) gets a readable page with a way back instead of a blank crash.
export function ErrorBoundary() {
  const error = useRouteError();
  const data = useRouteLoaderData<typeof loader>("routes/app");
  if (isRouteErrorResponse(error)) return boundary.error(error);
  console.error("[BadgeFlow]", error);
  return (
    <AppProvider embedded apiKey={data?.apiKey ?? ""}>
      <s-page heading="Something went wrong">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              BadgeFlow couldn&apos;t load this page. Your campaigns and badges are safe — this is usually a brief
              hiccup talking to Shopify.
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              <s-button variant="primary" onClick={() => window.location.reload()}>Try again</s-button>
              <s-button href="/app">Go to Home</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
