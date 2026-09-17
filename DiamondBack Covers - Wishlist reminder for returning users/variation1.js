(function () {
  try {
    var debug = 0;
    var variationName = "wishlist_reminder_variation_1";
    var CONFIG = {
      WISHLIST_PAGE_URL: "/pages/wishlist",
      MAX_ITEMS: 4,
      SUPPRESS_DAYS: 7,
      EXCLUDED_PATH_PATTERNS: [/^\/cart/i, /^\/checkout/i, /^\/pages\/wishlist/i],
      KEY_SUPPRESSED_UNTIL: "dbc_wr_suppressed_until", // epoch ms, set on close
      KEY_SHOWN_THIS_SESSION: "dbc_wr_shown_this_session", // sessionStorage flag
      KEY_WISHLIST_CACHE: "dbc_wr_wishlist_cache", // sessionStorage cache of raw Swym items
      KEY_PURCHASABLE_CACHE: "dbc_wr_purchasable_cache", // sessionStorage cache of purchasability lookups
    };
    // ---- Small helpers ------------------------------------------------
    function waitForElement(selector, trigger, delayInterval, delayTimeout) {
      var interval = setInterval(function () {
        if (
          document &&
          document.querySelector(selector) &&
          document.querySelectorAll(selector).length > 0
        ) {
          clearInterval(interval);
          trigger();
        }
      }, delayInterval);
      setTimeout(function () {
        clearInterval(interval);
      }, delayTimeout);
    }
    // Delegated ("live") click helper: fires `handler(matchedEl, event)` whenever a click's target matches `selector`.
     function live(selector, event, callback, context) {
            // Polyfill for matches
            if (typeof Element !== "undefined" && !Element.prototype.matches) {
                Element.prototype.matches =
                    Element.prototype.matchesSelector ||
                    Element.prototype.webkitMatchesSelector ||
                    Element.prototype.mozMatchesSelector ||
                    Element.prototype.msMatchesSelector ||
                    function (selector) {
                        var node = this,
                            nodes = (node.parentNode || node.document).querySelectorAll(selector),
                            i = -1;
                        while (nodes[++i] && nodes[i] != node);
                        return !!nodes[i];
                    };
            }

            // Attach event
            (context || document).addEventListener(event, function (e) {
                var el = e.target;
                while (el && el !== context) {
                    if (el.matches(selector)) {
                        callback.call(el, e);
                        break;
                    }
                    el = el.parentElement;
                }
            });
        };

    // Debug-only console logger, gated behind the `debug` flag.
    function log() {
      if (debug && typeof console !== "undefined") {
        console.log.apply(console, ["[" + variationName + "]"].concat([].slice.call(arguments)));
      }
    }
    // Reads a key from a storage object without throwing if storage is blocked.
    function safeGet(store, key) {
      try {
        return store.getItem(key);
      } catch (e) {
        return null;
      }
    }
    // Writes a key to a storage object without throwing if storage is blocked.
    function safeSet(store, key, val) {
      try {
        store.setItem(key, val);
      } catch (e) {}
    }
    // Reads and JSON-parses a cached value from sessionStorage (null if absent/blocked/invalid).
    function getSessionCache(key) {
      var raw = safeGet(sessionStorage, key);
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch (e) {
        return null;
      }
    }
    // JSON-stringifies and writes a value to sessionStorage.
    function setSessionCache(key, value) {
      try {
        safeSet(sessionStorage, key, JSON.stringify(value));
      } catch (e) {}
    }
    // Checks whether the current path matches an excluded page pattern.
    function isExcludedPage() {
      var path = window.location.pathname || "";
      return CONFIG.EXCLUDED_PATH_PATTERNS.some(function (re) {
        return re.test(path);
      });
    }
    // Checks whether the 7-day post-close suppression window is still active.
    function isSuppressed() {
      var until = parseInt(safeGet(localStorage, CONFIG.KEY_SUPPRESSED_UNTIL), 10);
      return !isNaN(until) && Date.now() < until;
    }
    // Sets the suppression timestamp SUPPRESS_DAYS days into the future.
    function suppressFor7Days() {
      var until = Date.now() + CONFIG.SUPPRESS_DAYS * 24 * 60 * 60 * 1000;
      safeSet(localStorage, CONFIG.KEY_SUPPRESSED_UNTIL, String(until));
    }
    // Checks whether the popup has already been shown in this session.
    function alreadyShownThisSession() {
      return safeGet(sessionStorage, CONFIG.KEY_SHOWN_THIS_SESSION) === "1";
    }
    // Flags in sessionStorage that the popup has been shown this session.
    function markShownThisSession() {
      safeSet(sessionStorage, CONFIG.KEY_SHOWN_THIS_SESSION, "1");
    }
    // Formats a Swym price (cents, usually) as a display string like "$20.99".
    function formatPrice(cents) {
      // Swym's `pr` field is documented in cents; guard in case a given
      // store config returns whole currency units instead.
      var amount = cents > 1000 ? cents / 100 : cents;
      // Figma spec renders plain "$2099.00" (no thousands separator) —
      // matched exactly rather than using Intl's locale grouping.
      return "$" + amount.toFixed(2);
    }
    // Formats a saved timestamp as "Added Mon D,YYYY", or null if missing/invalid.
    function formatSavedDate(ts) {
      if (!ts) return null;
      var d = new Date(ts);
      if (isNaN(d.getTime())) return null;
      var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      // Matches the Figma spec exactly: "Added Aug 20,2026" (no space before year).
      return "Added " + months[d.getMonth()] + " " + d.getDate() + "," + d.getFullYear();
    }
    // ---- Swym data fetching -------------------------------------------
  
    // Polls for Swym's `_swat` client to be ready; calls back with `null` (not silence) if it times out, so callers never hang.
    function waitForSwym(cb, attemptsLeft) {
      attemptsLeft = typeof attemptsLeft === "number" ? attemptsLeft : 40; // ~10s at 250ms
      if (window._swat && typeof window._swat.fetchLists === "function") {
        cb(window._swat);
        return;
      }
      if (attemptsLeft <= 0) {
        log("Swym (_swat) never became available on this page.");
        cb(null); // fallback: let callers treat this as "no data" instead of hanging
        return;
      }
      setTimeout(function () {
        waitForSwym(cb, attemptsLeft - 1);
      }, 250);
    }
    // Gets the visitor's wishlist contents from Swym, reusing a cached session copy when available.
    function fetchWishlistData(onDone) {
      var cached = getSessionCache(CONFIG.KEY_WISHLIST_CACHE);
      if (cached) {
        log("Using cached wishlist data from this session.");
        onDone(cached);
        return;
      }
      waitForSwym(function (swat) {
        if (!swat) {
          onDone([]); // fallback: Swym unavailable, nothing to show
          return;
        }
        swat.fetchLists({
          callbackFn: function (lists) {
            var wishlist = (lists || []).filter(function (l) {
              return l && (l.lty === "wl" || !l.lty);
            })[0];
            if (!wishlist) {
              log("No wishlist (lty: wl) found for this visitor.");
              onDone([]);
              return;
            }
            if (wishlist.listcontents && wishlist.listcontents.length) {
              setSessionCache(CONFIG.KEY_WISHLIST_CACHE, wishlist.listcontents);
              onDone(wishlist.listcontents);
              return;
            }
            swat.fetchListCtx(
              { lid: wishlist.lid },
              function (listContents) {
                var items = listContents || [];
                setSessionCache(CONFIG.KEY_WISHLIST_CACHE, items);
                onDone(items);
              },
              function (err) {
                log("fetchListCtx error", err);
                onDone([]);
              }
            );
          },
          errorFn: function (err) {
            log("fetchLists error", err);
            onDone([]);
          },
        });
      });
    }
    // Per Swym's own guidance: https://developers.getswym.com/docs/custom-wishlist-experience-using-js-sdk
    function checkPurchasable(item, cb) {
      var handle = null;
      try {
        var path = new URL(item.du, window.location.origin).pathname;
        var match = path.match(/\/products\/([^/?#]+)/);
        handle = match && match[1];
      } catch (e) {}
      if (!handle) {
        // Can't verify — err on the side of showing the item rather than
        // silently dropping something the visitor actually saved.
        cb(true);
        return;
      }
      var cache = getSessionCache(CONFIG.KEY_PURCHASABLE_CACHE) || {};
      var cacheEntryKey = handle + ":" + item.epi;
      if (Object.prototype.hasOwnProperty.call(cache, cacheEntryKey)) {
        cb(cache[cacheEntryKey]);
        return;
      }
      fetch("/products/" + handle + ".js", { credentials: "omit" })
        .then(function (res) {
          if (!res.ok) throw new Error("bad status " + res.status);
          return res.json();
        })
        .then(function (product) {
          var variant = (product.variants || []).filter(function (v) {
            return String(v.id) === String(item.epi);
          })[0];
          var purchasable = !!(variant && variant.available);
          cache[cacheEntryKey] = purchasable;
          setSessionCache(CONFIG.KEY_PURCHASABLE_CACHE, cache);
          cb(purchasable);
        })
        .catch(function (e) {
          log("Purchasability check failed for", handle, e);
          cb(true); // fail open — see comment above
        });
    }
    // Sorts saved items by recency and resolves the top N that are still purchasable (loop stops as soon as N are found).
    function getTopPurchasableItems(rawItems, max, cb) {
      var sorted = (rawItems || [])
        .slice()
        .sort(function (a, b) {
          return (b.cts || 0) - (a.cts || 0);
        });
      var results = [];
      var i = 0;
      function next() {
        if (i >= sorted.length || results.length >= max) {
          cb(results);
          return; // loop terminates here — no dangling recursion once resolved
        }
        var item = sorted[i++];
        checkPurchasable(item, function (purchasable) {
          if (purchasable) results.push(item);
          next();
        });
      }
      next();
    }
    // ---- Rendering ------------------------------------------------------
    // Builds and injects the popup DOM (skipped if one is already on the page).
    function buildModal(items) {
      if (document.querySelector(".dbc-wr-overlay")) {
        log("Overlay already present on the page — skipping duplicate build.");
        return;
      }
      var overlay = document.createElement("div");
      overlay.className = "dbc-wr-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", "Welcome back — your wishlist");
      var cardsHtml = items
        .map(function (item) {
          var savedLine = formatSavedDate(item.cts);
          return (
            '<div class="dbc-wr-item">' +
              '<a class="dbc-wr-item-imgwrap" href="' + item.du + '" tabindex="-1">' +
                '<img class="dbc-wr-item-img" src="' + item.iu + '" alt="' + escapeHtml(item.dt) + '" loading="lazy">' +
              "</a>" +
              '<div class="dbc-wr-item-body">' +
                '<a class="dbc-wr-item-title" href="' + item.du + '">' + escapeHtml(item.dt) + "</a>" +
                (savedLine ? '<div class="dbc-wr-item-saved">' + savedLine + "</div>" : "") +
                '<div class="dbc-wr-item-bottom-row">' +
                  '<div class="dbc-wr-item-price">' + formatPrice(item.pr) + "</div>" +
                  '<button type="button" class="dbc-wr-add-to-cart" data-variant-id="' + item.epi + '">Add to cart</button>' +
                "</div>" +
              "</div>" +
            "</div>"
          );
        })
        .join("");
      overlay.innerHTML =
        '<div class="dbc-wr-modal">' +
          '<button type="button" class="dbc-wr-close" aria-label="Close">&times;</button>' +
          '<h2 class="dbc-wr-heading">Welcome Back</h2>' +
          '<p class="dbc-wr-subheading">You have items in your Wishlist</p>' +
          '<div class="dbc-wr-items">' + cardsHtml + "</div>" +
          '<a class="dbc-wr-view-all" href="' + CONFIG.WISHLIST_PAGE_URL + '">View all saved items</a>' +
          '<button type="button" class="dbc-wr-no-thanks">Continue Shopping</button>' +
        "</div>";
      document.body.appendChild(overlay);
    }
    // Removes the popup (if present) and starts the 7-day suppression window.
    function closeModal() {
      suppressFor7Days();
      var overlay = document.querySelector(".dbc-wr-overlay");
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    // Closes the popup on Escape, only when it's actually open.
    function onKeydown(e) {
      if (e.key === "Escape" && document.querySelector(".dbc-wr-overlay")) closeModal();
    }
    
    // Adds a variant to the cart via the Shopify Ajax API and updates the clicked button's state.
    function handleAddToCart(btn) {
      var variantId = btn.getAttribute("data-variant-id");
      btn.disabled = true;
      var originalText = btn.textContent;
      btn.textContent = "Adding…";
      fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: variantId, quantity: 1 }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error("bad status " + res.status);
          return res.json();
        })
        .then(function () {
          btn.textContent = "Added ✓";
          // Let the theme's own cart drawer/count refresh however it
          // normally does (most Shopify themes listen for this).
          document.dispatchEvent(new CustomEvent("cart:refresh"));
        })
        .catch(function (e) {
          log("Add to cart failed", e);
          btn.disabled = false;
          btn.textContent = originalText;
          alert("Sorry, we couldn't add that to your cart. Please try from the product page.");
        });
    }
    // Wires all delegated click/keydown handlers exactly once, guarded by a window flag so repeat init() calls never double-attach.
   function attachEventHandlers() {
  if (window.__dbcWrHandlersAttached) return;
  window.__dbcWrHandlersAttached = true;

  live(".dbc-wr-close, .dbc-wr-no-thanks", "click", function () {
    closeModal();
  });

  // Click on the overlay backdrop itself (not its children) closes the modal.
  // `this` is the matched .dbc-wr-overlay element; only close when the click's
  // actual target IS the backdrop, not a bubbled click from inside the card.
  live(".dbc-wr-overlay", "click", function (e) {
    if (e.target === this) closeModal();
  });

  live(".dbc-wr-add-to-cart", "click", function () {
    handleAddToCart(this);
  });

  document.addEventListener("keydown", onKeydown);
}
    // Escapes a string for safe insertion into innerHTML.
    function escapeHtml(str) {
      var div = document.createElement("div");
      div.textContent = str == null ? "" : String(str);
      return div.innerHTML;
    }
    // ---- Entry point -----------------------------------------------------
    // Entry point: runs all gating checks, wires handlers once, then fetches data and shows the popup if eligible.
    function init() {
      document.querySelector("body").classList.add(variationName);
      if (isExcludedPage()) {
        log("Excluded page — skipping.");
        return;
      }
      if (alreadyShownThisSession()) {
        log("Already shown this session — skipping.");
        return;
      }
      if (isSuppressed()) {
        log("Suppressed (closed within last " + CONFIG.SUPPRESS_DAYS + " days) — skipping.");
        return;
      }
      attachEventHandlers();
      fetchWishlistData(function (rawItems) {
        if (!rawItems || !rawItems.length) {
          log("Wishlist is empty — skipping.");
          return;
        }
        getTopPurchasableItems(rawItems, CONFIG.MAX_ITEMS, function (items) {
          if (!items.length) {
            log("No purchasable saved items — skipping.");
            return;
          }
          buildModal(items);
          markShownThisSession();
        });
      });
    }
    waitForElement("body", init, 50, 15000);
  } catch (e) {
    if (typeof debug !== "undefined" && debug) console.log(e, "error in Test wishlist_reminder_variation_1");
  }
})();