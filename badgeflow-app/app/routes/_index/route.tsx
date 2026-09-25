import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";


import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop") || url.searchParams.get("host")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  // App Store requirement 2.3.1: installs start from Shopify, so never ask
  // merchants to type their myshopify.com domain here.
  return { showForm: false };
};

const FEATURES = [
  { title: "Schedule badges, no theme code", detail: "Pick a badge, target some products, and set a start and end time — BadgeFlow handles the rest once the storefront embed is on." },
  { title: "Preview before it goes live", detail: "See the exact badge placement on a real product image, and review the full campaign before shoppers see anything." },
  { title: "Works with your existing catalog", detail: "Target all products, a collection, or a hand-picked list — no separate product setup required." },
];

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <div className={styles.mark}>BadgeFlow</div>
        <h1 className={styles.heading}>Put the right badge on the right products, on a schedule.</h1>
        <p className={styles.text}>
          Sale, new-arrival, and low-stock badges on your product images — scheduled, previewed, and reviewed before they ever reach shoppers.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" placeholder="my-shop-domain.myshopify.com" />
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <p className={styles.note}>
          BadgeFlow runs inside your Shopify admin. Install it from the Shopify App Store, then open it from{" "}
          <strong>Apps → BadgeFlow</strong>.
        </p>
        <ul className={styles.list}>
          {FEATURES.map((f) => (
            <li key={f.title}>
              <strong>{f.title}</strong>
              {f.detail}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
