(function () {
  try {
    var debug = 0;
    var variation_name = "cre-t-97";

    /* ---- Config (edit these) --------------------------------------------- */
    var TARGET_SELECTOR = ".hero-section h1";              // inject BEFORE this
    var BUSINESS_UNIT_ID = "4bdc32d400006400050599a4";
    var REVIEW_URL = "https://uk.trustpilot.com/review/YOUR-DOMAIN.com";
    var LOCALE = "en-GB";
    var THEME = "light";
    var CONTAINER_ID = "ab-tp-hero";                    // guards re-injection (hero widget)
    var IMAGE_CONTAINER_SELECTOR = ".new-image-container";  // inject INTO this
    var IMAGE_WIDGET_ID = "ab-tp-image";                   // guards re-injection (image container widget)
    var BOOTSTRAP_SRC = "https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js";
    
    // Hero image: control's image has the Trustpilot badge baked into the
    // graphic itself, which would duplicate the widget injected above. Swap
    // in creative that has the badge removed. Width descriptors reuse the
    // control's own tiers (500w/800w/873w) so its existing `sizes` breakpoints
    // (max-width:767 / max-width:991 / else) keep resolving to the right file.
    var HERO_IMAGE_SELECTOR = ".new-image-container img.new-image";
    var HERO_IMAGES = {
      mobile: "https://v2.crocdn.com/unbiased/Test97/hero-banner-mobile.png",
      tablet: "https://v2.crocdn.com/unbiased/Test97/hero-banner-ipad.png",
      desktop: "https://v2.crocdn.com/unbiased/Test97/hero-banner-desktop.png"
    };
    /* ---------------------------------------------------------------------- */

    function waitForElement(selector, trigger, delayInterval = 50, delayTimeout = 15000) {
      var interval = setInterval(function () {
        if (document && document.querySelector(selector) && document.querySelectorAll(selector).length > 0) {
          clearInterval(interval);
          trigger(document.querySelector(selector));
        }
      }, delayInterval);
      setTimeout(function () {
        clearInterval(interval);
      }, delayTimeout);
    }

    /* Micro Combo TrustBox markup (word rating + stars + review count, one
       line). Desktop/tablet; visibility toggled against .ab-tp-star via CSS. */
    var MICRO_COMBO_HTML =
      '<div class="ab-tp-combo">' +
      '<div class="trustpilot-widget" data-locale="' + LOCALE + '"' +
      ' data-template-id="5419b6ffb0d04a076446a9af"' +
      ' data-businessunit-id="' + BUSINESS_UNIT_ID + '"' +
      ' data-style-height="24px" data-style-width="450px" data-theme="' + THEME + '">' +
      '<a href="' + REVIEW_URL + '" target="_blank" rel="noopener">Trustpilot</a>' +
      '</div>' +
      '</div>';

    /* Micro Star TrustBox markup (icon + stars only, fluid, one line) for
       the hero on mobile. The Micro Combo above is fluid too, but its longer
       text ("Excellent" + review count) doesn't wrap and can overflow narrow
       viewports, so mobile gets this shorter widget instead. Both widgets are
       injected unconditionally; variation.css toggles which one is visible
       per breakpoint so the switch doesn't depend on JS viewport checks. */
    var MICRO_STAR_HTML =
      '<div class="ab-tp-star">' +
      '<div class="trustpilot-widget" data-locale="' + LOCALE + '"' +
      ' data-template-id="5419b732fbfb950b10de65e5"' +
      ' data-businessunit-id="' + BUSINESS_UNIT_ID + '"' +
      ' data-style-height="24px" data-style-width="100%" data-theme="' + THEME + '">' +
      '<a href="' + REVIEW_URL + '" target="_blank" rel="noopener">Trustpilot</a>' +
      '</div>' +
      '</div>';

    /* Mini TrustBox markup (logo + stars + TrustScore | reviews, compact box) */
    var MINI_WIDGET_HTML =
      '<div id="' + IMAGE_WIDGET_ID + '" style="width:100%;max-width:100%;box-sizing:border-box;margin:0;">' +
      '<div class="trustpilot-widget" data-locale="' + LOCALE + '"' +
      ' data-template-id="53aa8807dec7e10d38f59f32"' +
      ' data-businessunit-id="' + BUSINESS_UNIT_ID + '"' +
      ' data-style-height="120px" data-style-width="200px" data-theme="' + THEME + '">' +
      '<a href="' + REVIEW_URL + '" target="_blank" rel="noopener">Trustpilot</a>' +
      '</div>' +
      '</div>';

    function initHero(target) {
      if (document.getElementById(CONTAINER_ID)) return;      // already injected, bail
      // Force full width so the widgets don't collapse inside a flex/grid hero:
      //  - width/flex-basis 100% -> takes the whole row if the hero is display:flex
      //  - grid-column 1/-1      -> spans all columns if the hero is display:grid
      var html =
        '<div id="' + CONTAINER_ID + '" style="width:100%;max-width:100%;' +
        'flex-basis:100%;grid-column:1/-1;box-sizing:border-box;margin:0 0 20px 0;">' +
        MICRO_COMBO_HTML +
        MICRO_STAR_HTML +
        '</div>';
      target.insertAdjacentHTML("beforebegin", html);
    }

    /* Point the existing hero <img> at the badge-free creative. Native srcset
       resolution (no resize listeners) picks the right file per breakpoint,
       matching the control's own screen-size tiers. */
    function initHeroImage(img) {
      if (img.dataset.abTpSwapped) return;     // already swapped, bail
      img.srcset =
        HERO_IMAGES.mobile + " 500w, " +
        HERO_IMAGES.tablet + " 800w, " +
        HERO_IMAGES.desktop + " 873w";
      img.src = HERO_IMAGES.desktop;   // fallback for browsers without srcset support
      img.dataset.abTpSwapped = "1";
    }

    function initImageContainer(target) {
      if (document.getElementById(IMAGE_WIDGET_ID)) return;   // already injected, bail
      target.insertAdjacentHTML("beforeend", MINI_WIDGET_HTML); // place INSIDE .new-image-container
      setTimeout(function() {
        if (window.Trustpilot && window.Trustpilot.Modules && window.Trustpilot.Modules.WidgetManagement) {
          // #ab-tp-hero now holds two widgets (combo + star, toggled via CSS),
          // so render all of them rather than assuming a single match.
          document.querySelectorAll("#ab-tp-hero .trustpilot-widget, #ab-tp-image .trustpilot-widget")?.forEach(function(el) {
            window.Trustpilot.Modules.WidgetManagement.createWidget(el);
          });
        }
      }, 0);
    }

    function waitforTrustPiolet(callBack) {
      let interval = setInterval(function () {
        if (window.Trustpilot && window.Trustpilot != 'undefined') {
          clearInterval(interval)
          callBack();
        }
      }, 50)

      setTimeout(function () {
        clearInterval(interval)
      }, 5000)
    }



    function init() {

      document.querySelector('body').classList.add(variation_name)

      waitForElement(TARGET_SELECTOR, initHero);
      waitForElement(IMAGE_CONTAINER_SELECTOR, initImageContainer);
      waitForElement(HERO_IMAGE_SELECTOR, initHeroImage);
    }

    /* Initialize variation */
    waitforTrustPiolet(init)


  } catch (e) {
    if (debug) console.log(e, "error in Test " + variation_name);
  }
})();