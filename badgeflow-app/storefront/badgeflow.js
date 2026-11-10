/* BadgeFlow storefront badges. Reads the config written by the app embed and
 * draws campaign badges on product images (collection/search/home cards and
 * the product page). Never throws into the theme: every step is guarded. */
(function () {
  "use strict";

  var MOBILE_MAX = 749;
  var ATTR = "data-badgeflow";
  var PRODUCT_MEDIA_SELECTORS = [
    ".product__media-item",
    ".product-media-container",
    ".product__media",
    ".product-single__media",
    ".product-gallery__media",
    "[data-product-media]",
    "[data-media-id]",
  ];

  function readJson(id) {
    var el = document.getElementById(id);
    if (!el) return null;
    try {
      return JSON.parse(el.textContent || "null");
    } catch (e) {
      return null;
    }
  }

  /* ---- Smart badge rules. Keep in step with app/lib/smart-badges.ts. ---- */

  // Biggest discount among the variants a shopper can buy (all variants when
  // none are in stock). Cents in, whole percent rounded DOWN out, so a badge
  // never overstates the discount.
  function bestDiscount(variants) {
    var list = variants || [];
    var buyable = list.filter(function (v) { return v.available !== false; });
    if (!buyable.length) buyable = list;
    var best = null;
    for (var i = 0; i < buyable.length; i++) {
      var price = Number(buyable[i].price), compare = Number(buyable[i].compareAt);
      if (!isFinite(price) || !isFinite(compare) || compare <= 0 || compare <= price) continue;
      var percent = Math.floor(((compare - price) * 100) / compare);
      var saving = compare - price;
      if (!best || percent > best.percent || (percent === best.percent && saving > best.savingCents)) {
        best = { percent: percent, savingCents: saving };
      }
    }
    return best;
  }

  function isNewProduct(publishedAt, days, now) {
    if (publishedAt === null || publishedAt === undefined || publishedAt === "") return false;
    var t = typeof publishedAt === "number" ? publishedAt : Date.parse(publishedAt);
    if (!isFinite(t) || t > now) return false;
    return now - t <= days * 86400000;
  }

  function renderTemplate(text, percent, amount) {
    return String(text).replace(/\{discount\}/gi, String(percent)).replace(/\{amount\}/gi, amount);
  }

  function radius(shape) {
    return shape === "pill" ? "999px" : shape === "square" ? "0" : "4px";
  }

  // Shopify's money_format ("${{amount}}", "{{amount_with_comma_separator}} €").
  function formatWithMoneyFormat(cents, format) {
    var match = /\{\{\s*(\w+)\s*\}\}/.exec(format);
    if (!match) return null;
    function delimit(n, decimals, thousands, decimal) {
      var fixed = (n / 100).toFixed(decimals).split(".");
      var whole = fixed[0].replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1" + thousands);
      return fixed[1] ? whole + decimal + fixed[1] : whole;
    }
    var value;
    switch (match[1]) {
      case "amount_no_decimals": value = delimit(cents, 0, ",", "."); break;
      case "amount_with_comma_separator": value = delimit(cents, 2, ".", ","); break;
      case "amount_no_decimals_with_comma_separator": value = delimit(cents, 0, ".", ","); break;
      case "amount_with_apostrophe_separator": value = delimit(cents, 2, "'", "."); break;
      case "amount_with_space_separator": value = delimit(cents, 2, " ", ","); break;
      default: value = delimit(cents, 2, ",", ".");
    }
    return format.replace(match[0], value).replace(/<[^>]*>/g, "");
  }

  // A saving in the shopper's currency. Whole amounts drop the ".00".
  function formatMoney(cents, currency, moneyFormat, locale) {
    if (currency && window.Intl && Intl.NumberFormat) {
      try {
        var whole = cents % 100 === 0;
        return new Intl.NumberFormat(locale || undefined, {
          style: "currency", currency: currency,
          minimumFractionDigits: whole ? 0 : undefined, maximumFractionDigits: whole ? 0 : undefined,
        }).format(cents / 100);
      } catch (e) { /* unknown currency: fall through */ }
    }
    if (moneyFormat) {
      var formatted = formatWithMoneyFormat(cents, moneyFormat);
      if (formatted) return formatted;
    }
    return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
  }

  // The badge to draw for one product, or null when a smart badge doesn't
  // apply to it. `product` is null when its data couldn't be loaded.
  function resolveBadge(c, product, now) {
    if (c.kind === "sale") {
      var d = product && bestDiscount(product.variants);
      if (!d || d.percent < Math.max(1, c.minDiscount || 0)) return null;
      var amount = formatMoney(d.savingCents, shopperCurrency(), context.moneyFormat, document.documentElement.lang);
      return { campaign: c, text: renderTemplate(c.text, d.percent, amount) };
    }
    if (c.kind === "new") {
      if (!product || !isNewProduct(product.publishedAt, c.newDays || 14, now)) return null;
      return { campaign: c, text: c.text };
    }
    return { campaign: c, text: c.text };
  }

  function shopperCurrency() {
    var s = window.Shopify;
    return (s && s.currency && s.currency.active) || context.currency || null;
  }

  // Test hook (Node's vm); harmless in the browser.
  window.__badgeflowRules = {
    bestDiscount: bestDiscount, isNewProduct: isNewProduct, renderTemplate: renderTemplate,
    radius: radius, formatMoney: formatMoney, formatWithMoneyFormat: formatWithMoneyFormat, resolveBadge: resolveBadge,
  };

  /* ---- Product data ---- */

  var config = readJson("badgeflow-config") || {};
  var context = readJson("badgeflow-context") || {};
  var rules = config.rules || {};
  // handle -> { available, variants?, publishedAt?, partial? }. Seeded from
  // Liquid (this page's collection or search results and the current
  // product); other cards are looked up on demand. `partial` entries only
  // know availability — enough for fixed-text badges, not for smart ones.
  var products = {};
  var seed = context.availability || {};
  for (var key in seed) products[String(key).toLowerCase()] = { available: seed[key] !== false, partial: true };
  if (context.productHandle && context.productAvailable != null) {
    products[String(context.productHandle).toLowerCase()] = { available: context.productAvailable !== false, partial: true };
  }
  var full = context.products || {};
  for (var h in full) products[String(h).toLowerCase()] = fromSeed(full[h]);

  // Liquid seed: { a: available, t: published (epoch seconds), v: [[price, compare_at, available], ...] }
  // with only the discounted variants listed.
  function fromSeed(p) {
    return {
      available: p.a !== false,
      publishedAt: p.t ? p.t * 1000 : null,
      variants: (p.v || []).map(function (v) { return { price: v[0], compareAt: v[1], available: v[2] !== false }; }),
    };
  }

  // Shopify's /products/{handle}.js shape, in the shopper's currency.
  function fromAjax(p) {
    return {
      available: p.available !== false,
      publishedAt: p.published_at || null,
      variants: (p.variants || []).map(function (v) {
        return { price: v.price, compareAt: v.compare_at_price, available: v.available !== false };
      }),
    };
  }

  var pendingLookups = {};
  var lookupCount = 0;
  var MAX_LOOKUPS = 60;
  // Links in these areas are navigation, not product cards.
  var SKIP_AREAS = "header, nav, footer, [role='navigation'], .breadcrumb, .breadcrumbs, [aria-label='breadcrumb'], .cart-drawer, cart-drawer, .predictive-search";
  var MIN_IMAGE_PX = 60;

  function activeCampaigns() {
    var now = Date.now();
    var list = (config.campaigns || []).filter(function (c) {
      var start = Date.parse(c.startAt);
      var end = c.endAt ? Date.parse(c.endAt) : Infinity;
      return !isNaN(start) && now >= start && now < end;
    });
    // Switched off in BadgeFlow: the theme editor shows only the sample.
    if (config.enabled === false) list = [];
    if (!list.length && context.designMode && context.showSample) {
      list = [{ id: "sample", text: "SALE", color: "#E33C2B", position: "top-left", size: 12, all: true, createdAt: "" }];
    }
    // Newest first, so "one badge per product" keeps the most recent campaign.
    return list.sort(function (a, b) {
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }

  // Campaigns that target this product, before smart-badge checks.
  function targeting(handle, active) {
    return active.filter(function (c) {
      return c.all || (c.handles && c.handles.indexOf(handle) !== -1);
    });
  }

  // Badges to draw on one product, or null while its data is still loading.
  // Smart badges that don't apply are skipped before "one badge per
  // product", so a sale badge on a full-price product doesn't hide another
  // campaign's badge.
  function badgesFor(handle, active, availableHint) {
    var matches = targeting(handle, active);
    if (!matches.length) return [];
    var smart = matches.some(function (c) { return c.kind === "sale" || c.kind === "new"; });
    var product = null;
    if (smart || (rules.hideSoldOut !== false && availableHint == null)) {
      product = lookup(handle, smart);
      if (product === undefined) return null;
    }
    var available = availableHint != null ? availableHint : product ? product.available : true;
    if (rules.hideSoldOut !== false && available === false) return [];
    var now = Date.now();
    var badges = [];
    for (var i = 0; i < matches.length; i++) {
      var b = resolveBadge(matches[i], product && !product.partial ? product : null, now);
      if (b) badges.push(b);
    }
    return rules.oneBadgePerProduct === false ? badges.slice(0, 3) : badges.slice(0, 1);
  }

  function handleFromHref(href) {
    var m = /\/products\/([^/?#]+)/.exec(href || "");
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]).toLowerCase();
    } catch (e) {
      return m[1].toLowerCase();
    }
  }

  function textColor(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r + g + b)) return "#fff";
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? "#1a1a1a" : "#fff";
  }

  // Shopify's Ajax product endpoint tells us whether a card's product is in
  // stock, its prices and when it was published. Until the answer arrives
  // the card gets no badge (undefined), so a sold-out product never flashes
  // one; a failed lookup shows fixed-text badges but no smart ones.
  function lookup(handle, needFull) {
    var known = products[handle];
    if (known && (!needFull || !known.partial)) return known;
    if (!pendingLookups[handle] && lookupCount < MAX_LOOKUPS && window.fetch) {
      lookupCount++;
      pendingLookups[handle] = true;
      var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
      fetch(root + "products/" + encodeURIComponent(handle) + ".js", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) { products[handle] = p ? fromAjax(p) : { available: true, partial: true, failed: true }; })
        .catch(function () { products[handle] = { available: true, partial: true, failed: true }; })
        .then(function () { delete pendingLookups[handle]; schedule(); });
    }
    if (pendingLookups[handle]) return undefined;
    // Out of lookups: draw what we can without the data.
    return known || { available: true, partial: true, failed: true };
  }

  function mediaContainerFor(img) {
    var el = img.parentElement;
    if (el && el.tagName === "PICTURE") el = el.parentElement;
    return el;
  }

  function place(container, badges) {
    if (!container || !badges || !badges.length) return;
    container.querySelectorAll("[" + ATTR + "-badge]").forEach(function (n) { n.remove(); });
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    var width = container.getBoundingClientRect().width || 300;
    var mobile = window.innerWidth <= MOBILE_MAX;

    badges.forEach(function (b, i) {
      var c = b.campaign;
      var position = (mobile && c.mobilePosition) || c.position || "top-left";
      var size = (mobile && c.mobileSize) || c.size || 12;
      var font = Math.max(9, Math.min(28, (width * size) / 300));
      if (mobile && rules.shrinkOnMobile) font = Math.max(8, font * 0.75);
      var inset = Math.max(6, Math.round(width * 0.04));
      var stack = i * (font * 2);

      // A custom element + !important inline styles, so theme rules that
      // stretch everything inside a media box (e.g. ".card__media > *")
      // can't resize or reposition the badge.
      var badge = document.createElement("badgeflow-badge");
      badge.setAttribute(ATTR + "-badge", c.id);
      badge.textContent = b.text;
      var styles = {
        position: "absolute", "z-index": "3", "pointer-events": "none", display: "inline-block",
        width: "auto", height: "auto", "min-width": "0", "min-height": "0", "max-width": "90%", "max-height": "none",
        top: "auto", right: "auto", bottom: "auto", left: "auto", margin: "0", transform: "none",
        "box-sizing": "border-box", background: c.color || "#E33C2B", color: textColor(c.color),
        "font-family": "inherit", "font-weight": "700", "font-size": font + "px", "line-height": "1.2",
        "letter-spacing": "0.02em", "text-transform": "none", padding: c.shape === "pill" ? "0.3em 0.8em" : "0.3em 0.6em", "border-radius": radius(c.shape),
        border: "0", "box-shadow": "none", opacity: "1", "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis",
      };

      var parts = position.split("-");
      var v = parts[0], h = parts[1];
      var transforms = [];
      if (v === "top") styles.top = inset + stack + "px";
      else if (v === "bottom") styles.bottom = inset + stack + "px";
      else { styles.top = "calc(50% + " + stack + "px)"; transforms.push("translateY(-50%)"); }
      if (h === "left") styles.left = inset + "px";
      else if (h === "right") styles.right = inset + "px";
      else { styles.left = "50%"; transforms.push("translateX(-50%)"); }
      if (transforms.length) styles.transform = transforms.join(" ");

      for (var k in styles) badge.style.setProperty(k, styles[k], "important");

      container.appendChild(badge);
    });
  }

  // True when `el` holds links to more than one product: it's a grid or a
  // list, not a single product card.
  function spansProducts(el, handle) {
    var links = el.querySelectorAll('a[href*="/products/"]');
    for (var i = 0; i < links.length; i++) {
      var h = handleFromHref(links[i].getAttribute("href"));
      if (h && h !== handle) return true;
    }
    return false;
  }

  function badgeCards(active) {
    var seen = new Set();
    document.querySelectorAll('a[href*="/products/"]').forEach(function (a) {
      if (a.closest(SKIP_AREAS)) return;
      var handle = handleFromHref(a.getAttribute("href"));
      if (!handle) return;
      if (!targeting(handle, active).length) return;
      var badges = badgesFor(handle, active, null);
      if (!badges || !badges.length) return;
      // Walk up to the card: the nearest ancestor that contains a product
      // image, without climbing into a container shared with other products.
      var card = a, img = a.querySelector("img");
      for (var i = 0; !img && card && i < 6; i++) {
        var parent = card.parentElement;
        if (!parent || spansProducts(parent, handle)) break;
        card = parent;
        img = card.querySelector("img");
      }
      if (!img) return;
      var rect = img.getBoundingClientRect();
      if (rect.width && rect.width < MIN_IMAGE_PX) return;
      var container = mediaContainerFor(img);
      if (!container || seen.has(container)) return;
      seen.add(container);
      place(container, badges);
    });
  }

  function badgeProductPage(active) {
    if (!context.productHandle) return;
    if (rules.hideSoldOut !== false && context.productAvailable === false) return;
    var target = null;
    for (var i = 0; !target && i < PRODUCT_MEDIA_SELECTORS.length; i++) {
      var el = document.querySelector(PRODUCT_MEDIA_SELECTORS[i]);
      if (el && el.querySelector("img")) target = el.matches("img") ? mediaContainerFor(el) : el;
    }
    if (!target) {
      var main = document.querySelector("main") || document.body;
      var img = main.querySelector("img");
      target = img && mediaContainerFor(img);
    }
    var badges = badgesFor(String(context.productHandle).toLowerCase(), active, context.productAvailable);
    if (badges) place(target, badges);
  }

  function run() {
    try {
      var active = activeCampaigns();
      document.querySelectorAll("[" + ATTR + "-badge]").forEach(function (n) { n.remove(); });
      if (!active.length) return;
      badgeProductPage(active);
      badgeCards(active);
    } catch (e) {
      if (window.console) console.warn("[BadgeFlow]", e);
    }
  }

  var timer = null;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  }

  function start() {
    run();
    window.addEventListener("resize", schedule);
    // Themes that load more products (infinite scroll, filters, quick view).
    // Only new product links or images matter, so busy themes (carousels,
    // timers) don't trigger a full redraw on every DOM change.
    var CARD_BITS = 'a[href*="/products/"], img';
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var nodes = records[i].addedNodes;
        for (var j = 0; j < nodes.length; j++) {
          var n = nodes[j];
          if (n.nodeType !== 1 || n.hasAttribute(ATTR + "-badge")) continue;
          if (n.matches(CARD_BITS) || n.querySelector(CARD_BITS)) return schedule();
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    // Theme editor: sections re-render in place.
    document.addEventListener("shopify:section:load", schedule);
    // Campaigns that start or end while the page is open.
    setInterval(run, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
