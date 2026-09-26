import type { LoginError } from "@shopify/shopify-app-react-router/server";
import { LoginErrorType } from "@shopify/shopify-app-react-router/server";

interface LoginErrorMessage {
  shop?: string;
}

export function loginErrorMessage(loginErrors: LoginError): LoginErrorMessage {
  if (loginErrors?.shop === LoginErrorType.MissingShop || loginErrors?.shop === LoginErrorType.InvalidShop) {
    return { shop: "We couldn't tell which store to open. Open BadgeFlow from your Shopify admin instead." };
  }

  return {};
}
