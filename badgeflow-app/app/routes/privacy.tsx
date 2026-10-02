import type { MetaFunction } from "react-router";

// Public privacy policy, linked from the App Store listing. Keep it in step
// with what the code actually stores and sends: prisma/schema.prisma, the
// GDPR webhooks in app/routes/webhooks.*, and app/lib/ai/*.
export const meta: MetaFunction = () => [{ title: "BadgeFlow privacy policy" }];

const UPDATED = "2 October 2026";
const CONTACT = "team@mpctrades.com";

const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "Who we are",
    body: [
      `BadgeFlow is a Shopify app made by MPC Trades. It lets merchants schedule badges (such as "SALE -20%") on product images in their online store. Questions about this policy: ${CONTACT}.`,
    ],
  },
  {
    heading: "What BadgeFlow stores",
    body: [
      "Your store's myshopify.com domain and the access token Shopify issues when you install the app, so BadgeFlow can act for your store.",
      "The campaigns you create: badge text, colour, position, size, which products or collection they target, and their schedule.",
      "Your BadgeFlow settings and current plan.",
      "If you connect the optional AI assistant: your Anthropic or OpenAI API key, encrypted (AES-256-GCM), plus the provider and model you chose. The key is never shown again or sent to your browser.",
      "BadgeFlow only has read access to your products (the read_products permission). It does not read or store orders, customers, or any personal data about your shoppers or staff.",
    ],
  },
  {
    heading: "What appears on your storefront",
    body: [
      "BadgeFlow saves your live and upcoming campaigns (badge design, schedule and the handles of targeted products) to a metafield on your store. The theme app embed reads it to draw badges. It contains no personal data. The embed may ask your store's own product endpoint whether a product is in stock, so sold-out products can skip the badge.",
    ],
  },
  {
    heading: "AI assistant (optional)",
    body: [
      "The AI assistant is off until you connect your own API key. When you use it, BadgeFlow sends your request, your store's timezone, and the names of your collections and products to the provider you chose (Anthropic or OpenAI), using your key. That provider processes it under its own terms and privacy policy. BadgeFlow does not send customer or order data to any AI provider.",
    ],
  },
  {
    heading: "How we use it",
    body: [
      "Only to run BadgeFlow for your store: showing your campaigns, publishing badges to your storefront, applying your plan's limits, and answering support requests. We don't sell data, use it for advertising, or share it with anyone except as described here.",
    ],
  },
  {
    heading: "Billing",
    body: [
      "Plans are billed by Shopify on your Shopify invoice. BadgeFlow never sees or stores payment details; it only reads which plan your store is on.",
    ],
  },
  {
    heading: "Where data is kept and for how long",
    body: [
      "Data is stored on our server, accessed over HTTPS only, and backed up nightly; backups are kept for 14 days.",
      "When you uninstall BadgeFlow, its access to your store ends immediately. Your campaigns and settings are kept for 48 hours in case you reinstall. Shopify then asks us to erase your store's data (the shop/redact request) and we delete everything we hold for your store: sessions, campaigns, settings and any AI key. It then disappears from backups within 14 days.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      `You can ask what we hold about your store, or ask us to delete it sooner, by emailing ${CONTACT}. We also respond to Shopify's customer data requests; because BadgeFlow stores no customer data, there is nothing about your shoppers to return or erase.`,
    ],
  },
  {
    heading: "Changes",
    body: ["If this policy changes, we'll update this page and the date below."],
  },
];

export default function Privacy() {
  return (
    <main
      style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: "#2B2620",
        background: "#FAFAF9",
        minHeight: "100vh",
        padding: "48px 16px",
        lineHeight: 1.6,
      }}
    >
      <article style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ fontWeight: 800, color: "#E25C07", letterSpacing: "0.02em" }}>BadgeFlow</div>
        <h1 style={{ fontSize: 30, margin: "8px 0 4px" }}>Privacy policy</h1>
        <p style={{ color: "#6B6259", marginTop: 0 }}>Last updated {UPDATED}</p>
        {SECTIONS.map((s) => (
          <section key={s.heading}>
            <h2 style={{ fontSize: 19, marginTop: 28 }}>{s.heading}</h2>
            {s.body.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
