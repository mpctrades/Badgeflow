import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fetchPreviewProducts, fetchShopInfo } from "../lib/shopify-catalog.server";
import { useQueryToast } from "../lib/use-toast";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  const campaign = id
    ? await db.campaign.findFirst({ where: { id, shop: session.shop } })
    : await db.campaign.findFirst({ where: { shop: session.shop }, orderBy: { createdAt: "desc" } });

  if (!campaign) throw redirect("/app/campaigns");

  const [shopInfo, products] = await Promise.all([
    fetchShopInfo(admin),
    fetchPreviewProducts(admin, 3),
  ]);

  return { campaign, shopName: shopInfo.name, products };
};

export default function StorefrontPreview() {
  const { campaign, shopName, products } = useLoaderData<typeof loader>();

  useQueryToast({
    published: "Campaign published — badges are live",
    scheduled: "Campaign scheduled",
  });

  function badgeStyle(): React.CSSProperties {
    const position = campaign.position;
    return {
      position: "absolute",
      ...(position.startsWith("top") ? { top: "8%" } : {}),
      ...(position.startsWith("bottom") ? { bottom: "8%" } : {}),
      ...(position.includes("middle") ? { top: "50%", transform: "translateY(-50%)" } : {}),
      ...(position.endsWith("left") ? { left: "8%" } : {}),
      ...(position.endsWith("right") ? { right: "8%" } : {}),
      ...(position.endsWith("center")
        ? { left: "50%", transform: position.includes("middle") ? "translate(-50%,-50%)" : "translateX(-50%)" }
        : {}),
      background: campaign.badgeColor, color: "#fff", fontWeight: 700,
      padding: "4px 8px", borderRadius: 6, fontSize: 8 + campaign.size / 2, whiteSpace: "nowrap",
    };
  }

  return (
    <s-page heading="Storefront preview">
      <s-link slot="breadcrumb-actions" href="/app/campaigns">Campaigns</s-link>
      <s-paragraph>What shoppers at {shopName} see during the active campaign window.</s-paragraph>

      <s-section>
        <div style={{ border: "1px solid #E3E2DB", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ background: "#FAF8F3", padding: "32px 28px", textAlign: "center" }}>
            <div style={{
              fontFamily: "Georgia, serif", fontSize: 13, letterSpacing: "0.22em",
              textTransform: "uppercase", color: "#8A6A3F", marginBottom: 10,
            }}>
              {shopName}
            </div>
            <h2 style={{ fontFamily: "Georgia, serif", fontSize: "clamp(22px,3.4vw,30px)", fontWeight: 600, color: "#2B2620", margin: 0 }}>
              {campaign.badgeText}
            </h2>
            <p style={{ color: "#6B7177", fontSize: "12.5px", marginTop: 10 }}>
              Previewing the campaign window: {new Date(campaign.startAt).toLocaleDateString()}
              {campaign.endAt ? ` – ${new Date(campaign.endAt).toLocaleDateString()}` : " (no end date)"}
            </p>
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16,
            padding: "24px 28px 30px", background: "#FAF8F3",
          }}>
            {products.length === 0 && (
              <s-text color="subdued">No products found in this store yet.</s-text>
            )}
            {products.map((p) => (
              <div key={p.id} style={{ background: "#fff", borderRadius: 10, overflow: "hidden", border: "1px solid #EADFCB" }}>
                <div style={{ position: "relative", aspectRatio: "1/1", background: "#F1ECDD" }}>
                  {p.imageUrl && (
                    <img src={p.imageUrl} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  )}
                  <span style={badgeStyle()}>{campaign.badgeText}</span>
                </div>
                <div style={{ padding: "10px 12px", fontSize: 12.5 }}>
                  <b style={{ display: "block" }}>{p.title}</b>
                  <span style={{ color: "#6B7177" }}>{p.price} {p.currency}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <s-box paddingBlockStart="base">
          <s-text color="subdued" fontSize="small">
            Badges appear only while a campaign is active — shoppers never see them outside the scheduled window.
          </s-text>
        </s-box>
        <s-box paddingBlockStart="base">
          <s-button href="/app/campaigns" variant="secondary">← Back to campaigns</s-button>
        </s-box>
      </s-section>
    </s-page>
  );
}
