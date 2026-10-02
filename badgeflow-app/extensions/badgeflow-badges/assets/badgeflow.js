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

  var config = readJson("badgeflow-config") || {};
  var context = readJson("badgeflow-context") || {};
  var rules = config.rules || {};
  // handle -> available. Seeded from Liquid (this page's collection or search
  // results and the current product); other cards are looked up on demand.
  var availability = {};
  var seed = context.availability || {};
  for (var key in seed) availability[String(key).toLowerCase()] = seed[key] !== false;
  if (context.productHandle && context.productAvailable != null) {
    availability[String(context.productHandle).toLowerCase()] = context.productAvailable !== false;
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

  function campaignsFor(handle, active) {
    var matches = active.filter(function (c) {
      return c.all || (c.handles && c.handles.indexOf(handle) !== -1);
    });
    return rules.oneBadgePerProduct === false ? matches.slice(0, 3) : matches.slice(0, 1);
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
  // stock. Until the answer arrives the card gets no badge, so a sold-out
  // product never flashes one; a failed lookup falls back to showing it.
  function isAvailable(handle) {
    if (handle in availability) return availability[handle];
    if (!pendingLookups[handle] && lookupCount < MAX_LOOKUPS && window.fetch) {
      lookupCount++;
      pendingLookups[handle] = true;
      var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
      fetch(root + "products/" + encodeURIComponent(handle) + ".js", { credentials: "same-origin" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) { availability[handle] = !p || p.available !== false; })
        .catch(function () { availability[handle] = true; })
        .then(function () { delete pendingLookups[handle]; schedule(); });
    }
    return lookupCount >= MAX_LOOKUPS && !pendingLookups[handle] ? true : null;
  }

  function mediaContainerFor(img) {
    var el = img.parentElement;
    if (el && el.tagName === "PICTURE") el = el.parentElement;
    return el;
  }

  function place(container, campaigns) {
    if (!container || !campaigns.length) return;
    container.querySelectorAll("[" + ATTR + "-badge]").forEach(function (n) { n.remove(); });
    if (getComputedStyle(container).position === "static") container.style.position = "relative";

    var width = container.getBoundingClientRect().width || 300;
    var mobile = window.innerWidth <= MOBILE_MAX;

    campaigns.forEach(function (c, i) {
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
      badge.textContent = c.text;
      var styles = {
        position: "absolute", "z-index": "3", "pointer-events": "none", display: "inline-block",
        width: "auto", height: "auto", "min-width": "0", "min-height": "0", "max-width": "90%", "max-height": "none",
        top: "auto", right: "auto", bottom: "auto", left: "auto", margin: "0", transform: "none",
        "box-sizing": "border-box", background: c.color || "#E33C2B", color: textColor(c.color),
        "font-family": "inherit", "font-weight": "700", "font-size": font + "px", "line-height": "1.2",
        "letter-spacing": "0.02em", "text-transform": "none", padding: "0.3em 0.6em", "border-radius": "4px",
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
      var matches = campaignsFor(handle, active);
      if (!matches.length) return;
      if (rules.hideSoldOut !== false && isAvailable(handle) !== true) return;
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
      place(container, matches);
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
    place(target, campaignsFor(String(context.productHandle).toLowerCase(), active));
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
