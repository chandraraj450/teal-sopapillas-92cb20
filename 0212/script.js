/* ============================================================
   CRACK SHOPPING - Load products.json  (single loader)
   ============================================================ */

var PRODUCTS_JSON_URL = 'products.json';

window.CRACK_SHOPPING_PRODUCT_DATASET = [];

(function () {

    var STORE_ORDER = ['amazon', 'flipkart', 'meesho', 'myntra'];
    var ALL_COMPARISON_STORES = STORE_ORDER;

    // products.json category text -> the data-category values used by the
    // category buttons in index.html (toy / electric / vehicles / kitchen-set).
    var CATEGORY_MAP = {
        'headphones / audio': { primary: 'headphones', groups: ['electric'] },
        'smartwatches': { primary: 'smartwatches', groups: ['electric'] },
        'mobile accessories': { primary: 'mobile-accessories', groups: ['electric'] },
        'bile accessories': { primary: 'mobile-accessories', groups: ['electric'] }, // typo in Meesho entry
        'kitchen appliances': { primary: 'kitchen-set', groups: [] },
        'toys': { primary: 'toy', groups: [] }
    };

    function toNumber(value) {
        var n = Number(value);
        return (value !== null && value !== undefined && value !== '' && isFinite(n) && n > 0) ? n : null;
    }

    function resolveCategories(rawCategory, name) {
        var key = String(rawCategory || '').trim().toLowerCase();
        var mapped = CATEGORY_MAP[key] || { primary: key.replace(/[^a-z0-9]+/g, '-'), groups: [] };
        var list = [mapped.primary].concat(mapped.groups);
        // "Vehicles" = toy cars / trains
        if (mapped.primary === 'toy' && /\b(car|train)\b/i.test(name || '')) {
            list.push('vehicles');
        }
        return { primary: mapped.primary, list: list };
    }

    function computeDiscount(mrp, price) {
        if (mrp && price && price <= mrp) {
            return Math.round(((mrp - price) / mrp) * 100);
        }
        return null;
    }

    function buildComparisonPrices(item) {
        // DEMO comparison (same as the old code): real price for the product's
        // own store, placeholder offsets for the other three.
        var base = item.price || item.oldPrice;
        var mrp = item.oldPrice || base;
        var steps = [0, 100, 51, 151];
        var out = {};
        ALL_COMPARISON_STORES.forEach(function (storeName, index) {
            var price = (storeName === item.store) ? base : (base ? base + steps[index % steps.length] : null);
            var d = computeDiscount(mrp, price);
            out[storeName] = { price: price, oldPrice: mrp, discount: (d === null ? 0 : d) + '% Off' };
        });
        return out;
    }

    function normalizeProduct(raw, storeName, index) {
        var name = raw.name || '';
        var mrp = toNumber(raw.mrp);
        var price = toNumber(raw.price);
        var cats = resolveCategories(raw.category, name);
        var brand = name.trim().split(/[\s,]+/)[0].toLowerCase();

        var item = {
            // unique id (products.json repeats ids, e.g. Amazon "04" x3)
            id: storeName + '-' + (index + 1),
            sourceId: raw.id,
            title: name,
            name: name,
            store: storeName,
            brand: brand,
            category: cats.primary,
            categories: cats.list,
            categoryLabel: raw.category || '',
            image: raw.image || '',
            price: price,
            oldPrice: mrp,
            // always recomputed: JSON has bad values (431, "269OFF", null)
            discount: computeDiscount(mrp, price),
            link: raw.link || '',
            dealUrl: raw.link || ''
        };
        item.prices = buildComparisonPrices(item);
        return item;
    }

    // One product per store in turn (highest discount first inside each
    // store) so the 6-card Best Deals row is a mix, not 6 Amazon cards.
    function interleaveByStore(byStore) {
        var queues = STORE_ORDER.map(function (storeName) {
            return (byStore[storeName] || []).slice().sort(function (a, b) {
                var da = (a.discount === null ? -1 : a.discount);
                var db = (b.discount === null ? -1 : b.discount);
                return db - da;
            });
        });
        var result = [];
        var added = true;
        while (added) {
            added = false;
            queues.forEach(function (q) {
                if (q.length) { result.push(q.shift()); added = true; }
            });
        }
        return result;
    }

    function buildDataset(data) {
        var byStore = {};
        Object.keys(data).forEach(function (storeName) {
            if (!Array.isArray(data[storeName])) return;
            byStore[storeName] = data[storeName].map(function (raw, index) {
                return normalizeProduct(raw, storeName, index);
            });
        });
        var ordered = interleaveByStore(byStore);
        var total = ordered.length;
        ordered.forEach(function (item, idx) { item.popularity = total - idx; });
        return ordered;
    }

    function refreshUi() {
        var api = window.CrackShopping && window.CrackShopping.products;
        if (api && typeof api.applyCategoryFilter === 'function') {
            api.applyCategoryFilter('');
        }
    }

    function showLoadError() {
        function paint() {
            var grid = document.getElementById('best-deals-grid');
            if (!grid) return;
            grid.textContent = '';
            var p = document.createElement('p');
            p.className = 'no-results-message';
            p.textContent = 'Products load nahi ho paye. Site ko local/live server se kholein (file:// se products.json load nahi hoti).';
            grid.appendChild(p);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', paint);
        } else {
            paint();
        }
    }

    window.CRACK_SHOPPING_PRODUCTS_READY = fetch(PRODUCTS_JSON_URL, { cache: 'no-store' })
        .then(function (response) {
            if (!response.ok) {
                throw new Error('products.json request failed with status ' + response.status);
            }
            return response.json();
        })
        .then(function (data) {
            var dataset = buildDataset(data);
            // Same array reference is shared with Part 4 - mutate, don't replace.
            window.CRACK_SHOPPING_PRODUCT_DATASET.push.apply(window.CRACK_SHOPPING_PRODUCT_DATASET, dataset);
            window.CRACK_SHOPPING_RAW_PRODUCTS = data;
            console.log('[Crack Shopping] products.json loaded:', dataset.length, 'products');
            refreshUi();   // no-op if the app has not initialised yet; Part 4 will pick the data up
            return data;
        })
        .catch(function (error) {
            console.error('[Crack Shopping] products.json load failed:', error);
            showLoadError();
            return null;
        });

})();

/* ============================================================
   CRACK SHOPPING - script.js
   PART 1 — JavaScript Foundation + DOM Initialization
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    /* ============================================================
       UTILITY / HELPER FUNCTIONS
       ============================================================ */

    function qs(selector, scope) {
        try {
            return (scope || document).querySelector(selector);
        } catch (err) {
            console.warn('qs() failed for selector:', selector, err);
            return null;
        }
    }

    function qsa(selector, scope) {
        try {
            return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
        } catch (err) {
            console.warn('qsa() failed for selector:', selector, err);
            return [];
        }
    }

    function setText(el, value) {
        if (!el) return;
        el.textContent = (value === null || value === undefined) ? '' : String(value);
    }

    function setAttr(el, attr, value) {
        if (!el) return;
        el.setAttribute(attr, value);
    }

    function on(el, eventName, handler, options) {
        if (!el) return;
        el.addEventListener(eventName, handler, options || false);
    }

    function debounce(fn, delay) {
        var timerId = null;
        return function debounced() {
            var context = this;
            var args = arguments;
            clearTimeout(timerId);
            timerId = setTimeout(function () {
                fn.apply(context, args);
            }, delay || 150);
        };
    }

    function formatPrice(amount) {
        var num = Number(amount);
        if (!isFinite(num)) return '₹0';
        try {
            return '₹' + num.toLocaleString('en-IN');
        } catch (err) {
            return '₹' + num;
        }
    }

    function shareProductDetails(productItem, platformOverride) {
        if (!productItem) {
            showShareFeedback('Product details could not be found. Please refresh the page.');
            return;
        }

        var title = productItem.title || productItem.name || 'Product';
        var store = platformOverride || productItem.store || 'online store';
        // Base URL of THIS website (no query / hash).
        var pageUrl = window.location.origin + window.location.pathname;

        // The shared link must ALWAYS open Crack Shopping first - never the
        // Amazon/Flipkart/Meesho/Myntra link directly. If the product exists
        // in our dataset we deep-link to it (?product=<id>); otherwise the
        // link simply opens the Crack Shopping home page.
        var dataset = window.CRACK_SHOPPING_PRODUCT_DATASET || [];
        var knownProduct = productItem.id && dataset.some(function (p) { return p.id === productItem.id; });
        var productUrl = knownProduct
            ? pageUrl + '?product=' + encodeURIComponent(productItem.id)
            : pageUrl;
        var priceText = (productItem.price !== null && productItem.price !== undefined && productItem.price !== '')
            ? 'Price: ' + formatPrice(productItem.price) + '\n' : '';
        var bodyText = title + '\n' + priceText +
            'Store: ' + store.charAt(0).toUpperCase() + store.slice(1) + '\n' +
            'Crack Shopping:';
        // Full text (link included) for WhatsApp / clipboard.
        var shareText = bodyText + ' ' + productUrl;

        // Prefer the phone/browser native share sheet when it is available.
        if (navigator.share) {
            try {
                var sharePromise = navigator.share({
                    title: title + ' | Crack Shopping',
                    text: bodyText,
                    url: productUrl
                });
                if (sharePromise && typeof sharePromise.catch === 'function') {
                    sharePromise.catch(function (error) {
                        if (!error || error.name !== 'AbortError') {
                            openWhatsAppShare(shareText);
                        }
                    });
                }
                return;
            } catch (error) {
                // Continue to the WhatsApp fallback below.
            }
        }

        // Desktop browsers often do not support navigator.share; open a real
        // WhatsApp share page instead of silently relying on clipboard access.
        openWhatsAppShare(shareText);
    }

    function openWhatsAppShare(shareText) {
        var shareUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText);
        // NOTE: with the 'noopener' feature window.open() ALWAYS returns null,
        // which wrongly looked like "pop-up blocked". Open normally and cut the
        // opener link manually instead.
        var shareWindow = window.open(shareUrl, '_blank');
        if (shareWindow) {
            try { shareWindow.opener = null; } catch (e) {}
            showShareFeedback('WhatsApp share opened in a new tab. Choose a contact to send it.');
        } else {
            // If pop-ups are blocked, give the user a direct link to open.
            showShareFeedback('Pop-up blocked. Copying product details instead.');
            copyShareText(shareText);
        }
    }

    function copyShareText(textToCopy) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(textToCopy).then(function () {
                showShareFeedback('Product details copied. Paste them anywhere to share.');
            }).catch(function () { legacyCopyShareText(textToCopy); });
        } else {
            legacyCopyShareText(textToCopy);
        }
    }

    function legacyCopyShareText(textToCopy) {
        var field = document.createElement('textarea');
        field.value = textToCopy;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (e) {}
        field.remove();
        showShareFeedback(copied ? 'Product details copied. Paste them anywhere to share.' : 'Sharing is not available in this browser.');
    }

    function showShareFeedback(message) {
        var feedback = document.getElementById('product-share-feedback');
        if (!feedback) {
            feedback = document.createElement('div');
            feedback.id = 'product-share-feedback';
            feedback.className = 'product-share-feedback';
            feedback.setAttribute('role', 'status');
            document.body.appendChild(feedback);
        }
        feedback.textContent = message;
        feedback.classList.add('is-visible');
        window.setTimeout(function () { feedback.classList.remove('is-visible'); }, 2600);
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function normalizeSearchText(str) {
        return (str || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
    }

    // Builds a real store URL to redirect the user to (search results page
    // for the given product on that store). Swap the base URLs below for
    // your real Amazon Associates / Flipkart / EarnKaro / CueLinks
    // affiliate links whenever those are ready — the rest of the app just
    // calls this function, so nothing else needs to change.
    var STORE_BASE_URLS = {

        amazon: 'https://www.amazon.in/s?k=',
        flipkart: 'https://www.flipkart.com/search?q=',
        meesho: 'https://www.meesho.com/search?q=',
        myntra: 'https://www.myntra.com/' 
    };

    function buildStoreSearchUrl(store, query) {
        var q = encodeURIComponent((query || '').toString().trim());
        if (store === 'myntra') {
            // Myntra's search puts the query in the path, not a query string.
            return STORE_BASE_URLS.myntra + q;
        }
        var base = STORE_BASE_URLS[store];
        if (!base) {
            return 'https://www.google.com/search?q=' + q;
        }
        return base + q;
    }

    /* ============================================================
       CENTRAL DOM ELEMENT REFERENCES
       ============================================================ */

    var dom = {
        siteHeader: qs('#site-header'),
        homeLink: qs('#home-link'),
        headerNav: qs('#header-nav'),
        mobileMenuToggle: qs('#mobile-menu-toggle'),
        navHome: qs('#nav-home'),
        navPrivacyPolicy: qs('#nav-privacy-policy'),
        navTermsConditions: qs('#nav-terms-conditions'),
        navAffiliateDisclaimer: qs('#nav-affiliate-disclaimer'),
        navContact: qs('#nav-contact'),

        footerNavHome: qs('#footer-nav-home'),
        footerNavPrivacyPolicy: qs('#footer-nav-privacy-policy'),
        footerNavTermsConditions: qs('#footer-nav-terms-conditions'),
        footerNavAffiliateDisclaimer: qs('#footer-nav-affiliate-disclaimer'),
        footerNavContact: qs('#footer-nav-contact'),
        footerCurrentYear: qs('#footer-current-year'),

        centerContent: qs('#center-content'),
        heroSearchSection: qs('#hero-search-section'),
        productLinkSearchForm: qs('#product-link-search-form'),
        productLinkInput: qs('#product-link-input'),
        findBestPriceBtn: qs('#find-best-price-btn'),

        categoryQuickButtons: qs('#category-quick-buttons'),
        categoryFilterToggleBtn: qs('#category-filter-toggle-btn'),
        categoryFilterDrawer: qs('#category-filter-drawer'),

        bestDealsGrid: qs('#best-deals-grid'),
        bestDealsScrollSentinel: qs('#best-deals-scroll-sentinel'),
        moreDealsGrid: qs('#more-deals-grid'),
        moreDealsScrollSentinel: qs('#more-deals-scroll-sentinel'),

        searchResultsSection: qs('#search-results-section'),
        searchedProductName: qs('#searched-product-name'),
        mainSearchedProductCard: qs('#main-searched-product-card'),
        mainProductImage: qs('#main-product-image'),
        mainProductTitle: qs('#main-product-title'),
        ratingStars: qs('#rating-stars'),
        ratingValue: qs('#rating-value'),
        ratingCount: qs('#rating-count'),
        priceBlockLabel: qs('#price-block-label'),
        priceBlockCurrent: qs('#price-block-current'),
        priceBlockOld: qs('#price-block-old'),
        priceBlockDiscountTag: qs('#price-block-discount-tag'),
        buyOnAmazonBtn: qs('#buy-on-amazon-btn'),

        priceComparisonGrid: qs('#price-comparison-grid'),
        comparisonCardAmazon: qs('#comparison-card-amazon'),
        comparisonCardFlipkart: qs('#comparison-card-flipkart'),
        comparisonCardMeesho: qs('#comparison-card-meesho'),
        comparisonCardMyntra: qs('#comparison-card-myntra'),

        filterDrawerInner: qs('#filter-drawer-inner'),
        filterApplyBtn: qs('#filter-apply-btn'),
        filterClearAllBtn: qs('#filter-clear-all-btn'),

        productComparisonModal: qs('#product-comparison-modal'),
        productComparisonModalClose: qs('#product-comparison-modal-close'),
        modalProductImage: qs('#modal-product-image'),
        modalProductTitle: qs('#modal-product-title'),
        modalRatingStars: qs('#modal-rating-stars'),
        modalRatingValue: qs('#modal-rating-value'),

        privacyPolicyModal: qs('#privacy-policy-modal'),
        privacyPolicyModalClose: qs('#privacy-policy-modal-close'),
        termsConditionsModal: qs('#terms-conditions-modal'),
        termsConditionsModalClose: qs('#terms-conditions-modal-close'),
        affiliateDisclaimerModal: qs('#affiliate-disclaimer-modal'),
        affiliateDisclaimerModalClose: qs('#affiliate-disclaimer-modal-close'),
        contactModal: qs('#contact-modal'),
        contactModalClose: qs('#contact-modal-close')
    };

    /* ============================================================
       CENTRAL APPLICATION STATE
       ============================================================ */

    var appState = {
        activeCategory: '',
        activeSearchMode: 'category',
        activeKeywordQuery: '',
        activeFilters: {
            price: null,
            discount: null,
            rating: null,
            brands: [],
            offers: [],
            availability: [],
            colors: [],
            sizes: [],
            genders: [],
            sortBy: 'popular'
        },
        searchedProduct: null,
        activeComparisonProduct: null,
        deals: {
            bestDealsRendered: 0,
            moreDealsRendered: 0,
            isLoading: false,
            isExhausted: false,
            currentlyDisplayedIds: []
        },
        openModalId: null
    };

    /* ============================================================
       INITIAL UI STATE
       ============================================================ */

    if (dom.footerCurrentYear) {
        setText(dom.footerCurrentYear, new Date().getFullYear());
    }

    if (dom.categoryFilterDrawer) {
        setAttr(dom.categoryFilterDrawer, 'data-drawer-state', 'closed');
    }
    if (dom.categoryFilterToggleBtn) {
        setAttr(dom.categoryFilterToggleBtn, 'aria-expanded', 'false');
    }

    qsa('.modal-overlay').forEach(function (modalEl) {
        setAttr(modalEl, 'data-modal-state', 'closed');
    });

    /* ============================================================
       EXPOSE SHARED NAMESPACE FOR SUBSEQUENT PARTS
       ============================================================ */

    window.CrackShopping = {
        dom: dom,
        state: appState,
        utils: {
            qs: qs,
            qsa: qsa,
            setText: setText,
            setAttr: setAttr,
            on: on,
            debounce: debounce,
            formatPrice: formatPrice,
            clamp: clamp,
            normalizeSearchText: normalizeSearchText,
            buildStoreSearchUrl: buildStoreSearchUrl,
            shareProductDetails: shareProductDetails
        }
    };

});

/* ============================================================
   PART 2 — Navigation + Home Reset Logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;

    function closeAllModals() {
        var openModals = utils.qsa('.modal-overlay[data-modal-state="open"]');
        openModals.forEach(function (modalEl) {
            utils.setAttr(modalEl, 'data-modal-state', 'closed');
        });
        state.openModalId = null;
        document.body.classList.remove('modal-open');
    }

    function closeFilterDrawer() {
        if (!dom.categoryFilterDrawer) return;
        utils.setAttr(dom.categoryFilterDrawer, 'data-drawer-state', 'closed');
        if (dom.categoryFilterToggleBtn) {
            utils.setAttr(dom.categoryFilterToggleBtn, 'aria-expanded', 'false');
        }
    }

    // Toggles "search active" mode off/on. When active, CSS (scoped to
    // #center-content[data-search-active="true"]) hides the hero
    // badge/heading/subtext/illustration, the store badges, the category
    // rail and the curated "Best Deals" grid — the search bar itself lives
    // inside #hero-search-section too, so it always stays visible, and the
    // searched product + price comparison land right below it.
    function setHeroTextVisibility(visible) {
        var targetEl = dom.centerContent || dom.heroSearchSection;
        if (!targetEl) return;
        if (visible) {
            targetEl.removeAttribute('data-search-active');
        } else {
            utils.setAttr(targetEl, 'data-search-active', 'true');
        }
    }

    function resetSearchResultsView() {
        if (dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'hidden');
        }
        state.searchedProduct = null;
        setHeroTextVisibility(true);
    }

    function clearSearchInput() {
        if (dom.productLinkInput) {
            dom.productLinkInput.value = '';
        }
    }

    function resetActiveCategory() {
        state.activeCategory = '';
        utils.qsa('.category-btn').forEach(function (btn) {
            btn.classList.remove('is-active');
            utils.setAttr(btn, 'aria-pressed', 'false');
        });
    }

    function resetAllFilters() {
        state.activeFilters = {
            price: null,
            discount: null,
            rating: null,
            brands: [],
            offers: [],
            availability: [],
            colors: [],
            sizes: [],
            genders: [],
            sortBy: 'popular'
        };

        utils.qsa('.filter-option-btn').forEach(function (btn) {
            btn.classList.remove('is-active');
            utils.setAttr(btn, 'aria-pressed', 'false');
        });

        utils.qsa('.color-swatch').forEach(function (swatch) {
            swatch.classList.remove('is-active');
        });

        utils.qsa('.size-option-btn').forEach(function (btn) {
            btn.classList.remove('is-active');
        });

        utils.qsa('#filter-drawer-inner input[type="checkbox"]').forEach(function (checkbox) {
            checkbox.checked = false;
        });

        var popularRadio = utils.qs('#sort-popular');
        utils.qsa('#filter-drawer-inner input[type="radio"]').forEach(function (radio) {
            radio.checked = false;
        });
        if (popularRadio) {
            popularRadio.checked = true;
        }
    }

    function scrollToTop() {
        // 'instant' (not 'smooth') so the user lands at the very top of the
        // page immediately — no visible slide/scroll animation at all.
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }

    function handleHomeReset(event) {
        if (event) {
            event.preventDefault();
        }

        closeAllModals();
        closeFilterDrawer();
        resetSearchResultsView();
        clearSearchInput();
        resetActiveCategory();
        resetAllFilters();
        scrollToTop();

        document.dispatchEvent(new CustomEvent('crackshopping:homeReset'));
    }

    utils.on(dom.homeLink, 'click', handleHomeReset);
    utils.on(dom.navHome, 'click', handleHomeReset);
    utils.on(dom.footerNavHome, 'click', handleHomeReset);

    utils.on(dom.mobileMenuToggle, 'click', function () {
        if (!dom.headerNav) return;
        var isOpen = dom.headerNav.classList.toggle('is-open');
        utils.setAttr(dom.mobileMenuToggle, 'aria-expanded', isOpen ? 'true' : 'false');
    });

    window.CrackShopping.navigation = {
        closeAllModals: closeAllModals,
        closeFilterDrawer: closeFilterDrawer,
        resetSearchResultsView: resetSearchResultsView,
        clearSearchInput: clearSearchInput,
        resetActiveCategory: resetActiveCategory,
        resetAllFilters: resetAllFilters,
        scrollToTop: scrollToTop,
        handleHomeReset: handleHomeReset,
        setHeroTextVisibility: setHeroTextVisibility
    };

});

/* ============================================================
   PART 3 — Search Bar + Product Link Recognition
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;

    var PLATFORM_PATTERNS = [
        { platform: 'amazon', hostPattern: /amazon\.|amzn\.(in|to)/i },
        { platform: 'flipkart', hostPattern: /flipkart\.com|fkrt\./i },
        { platform: 'meesho', hostPattern: /meesho\.com/i },
        { platform: 'myntra', hostPattern: /myntra\.com/i }
    ];

    var DEMO_SEARCHED_PRODUCT = {
        id: 'boat-rockerz-450',
        title: 'boAt Rockerz 450 Bluetooth On-Ear Headphones with Mic (Black)',
        image: 'assets/products/boat-rockerz-450.png',
        rating: 4.2,
        reviewsCount: '1,23,456',
        specs: ['Bluetooth 5.0', 'Up to 15 Hours Playback', 'Built-in Microphone', '40mm Dynamic Drivers'],
        prices: {
            amazon: { price: 1799, oldPrice: 3990, discount: '55% Off' },
            flipkart: { price: 1899, oldPrice: 3990, discount: '53% Off' },
            meesho: { price: 1850, oldPrice: 3990, discount: '54% Off' },
            myntra: { price: 1950, oldPrice: 3990, discount: '51% Off' }
        }
    };

    /* ------------------------------------------------------------
       DUAL-MODE DETECTION
       A single search bar must understand two very different kinds
       of input: a pasted store URL, or a plain keyword (English or
       Hindi). detectSearchMode() is the ONLY place that decides
       which of the two the user meant — everything else just
       routes to handleUrlSearch() or handleKeywordSearch().
       ------------------------------------------------------------ */

    // A string only "looks like" a URL when it has no spaces (URLs never
    // contain unescaped whitespace, but multi-word keywords like
    // "toy car" or "kitchen set" always do) AND it either already carries
    // a protocol, or its bare hostname has a real dot-separated domain
    // shape (e.g. "amazon.in/dp/xyz", "amzn.in/d/xyz"). Single words with
    // no dot ("car", "kitchen", "headphones") never match this, so they
    // fall straight through to keyword search.
    var BARE_DOMAIN_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i;

    function detectSearchMode(rawInput) {
        var trimmed = (rawInput || '').trim();

        if (!trimmed) {
            return { mode: 'empty' };
        }

        if (/\s/.test(trimmed)) {
            return { mode: 'keyword', query: trimmed };
        }

        var hasProtocol = /^https?:\/\//i.test(trimmed);
        var looksLikeBareDomain = BARE_DOMAIN_PATTERN.test(trimmed);

        if (!hasProtocol && !looksLikeBareDomain) {
            return { mode: 'keyword', query: trimmed };
        }

        var candidate = hasProtocol ? trimmed : ('https://' + trimmed);
        var parsedUrl;
        try {
            parsedUrl = new URL(candidate);
        } catch (err) {
            // Doesn't even parse as a URL once given a protocol — treat
            // whatever the user typed as a keyword instead of throwing
            // an "invalid link" error at a plain search term.
            return { mode: 'keyword', query: trimmed };
        }

        // A hostname with no dot at all (e.g. "https://localhost") is not
        // a real store domain — fall back to keyword search rather than
        // pretending it's a link.
        if (!/\./.test(parsedUrl.hostname)) {
            return { mode: 'keyword', query: trimmed };
        }

        return { mode: 'url', url: parsedUrl, raw: trimmed };
    }

    function detectPlatformFromUrl(parsedUrl) {
        for (var i = 0; i < PLATFORM_PATTERNS.length; i++) {
            if (PLATFORM_PATTERNS[i].hostPattern.test(parsedUrl.hostname)) {
                return PLATFORM_PATTERNS[i].platform;
            }
        }
        return null;
    }

    function showSearchError(message) {
        if (!dom.productLinkSearchForm) return;

        var errorEl = utils.qs('#product-link-search-error');
        if (!errorEl) {
            errorEl = document.createElement('p');
            errorEl.id = 'product-link-search-error';
            errorEl.className = 'search-input-error-text';
            errorEl.setAttribute('role', 'alert');
            dom.productLinkSearchForm.insertAdjacentElement('afterend', errorEl);
        }
        utils.setText(errorEl, message);
    }

    function clearSearchError() {
        var errorEl = utils.qs('#product-link-search-error');
        if (errorEl) {
            utils.setText(errorEl, '');
        }
    }

    function hideUrlSearchResults() {
        if (dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'hidden');
        }
        state.searchedProduct = null;
        if (window.CrackShopping.navigation) {
            window.CrackShopping.navigation.setHeroTextVisibility(true);
        }
    }

    function renderSearchResults(parsedLink,productOverride) {
        var product = productOverride || DEMO_SEARCHED_PRODUCT;
        var platform = parsedLink.platform;
        var priceInfo = product.prices
    ? (product.prices[platform] || product.prices.amazon)
    : {
        price: product.price,
        oldPrice: product.oldPrice,
        discount: (product.discount === null || product.discount === undefined) ? '' : product.discount + '% Off'
    };

        state.activeSearchMode = 'url';
        state.searchedProduct = {
            product: product,
            platform: platform,
            searchedUrl: parsedLink.url.href
        };

        if (dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'visible');
        }

        // Hide the big hero heading/badge/subtext so only the search bar
        // stays up top, and jump straight to the top of the page so the
        // search bar + comparison results are what the user sees first —
        // instead of the page appearing to scroll down.
        if (window.CrackShopping.navigation) {
            window.CrackShopping.navigation.setHeroTextVisibility(false);
            window.CrackShopping.navigation.scrollToTop();
        }

        utils.setText(dom.searchedProductName, product.title.split(' ').slice(0, 3).join(' '));

        if (dom.mainProductImage) {
            dom.mainProductImage.setAttribute('src', product.image);
            dom.mainProductImage.setAttribute('alt', product.title);
        }
        utils.setText(dom.mainProductTitle, product.title);
        utils.setText(dom.ratingValue, product.rating ? '(' + product.rating + ')' : '');
        utils.setText(dom.ratingCount, product.reviewsCount ? product.reviewsCount + ' ratings' : '');

        var platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
        utils.setText(dom.priceBlockLabel, 'Price on ' + platformLabel);
        utils.setText(dom.priceBlockCurrent, priceInfo.price ? utils.formatPrice(priceInfo.price) : 'Check price on store');
        utils.setText(dom.priceBlockOld, (priceInfo.price && priceInfo.oldPrice > priceInfo.price) ? utils.formatPrice(priceInfo.oldPrice) : '');
        utils.setText(dom.priceBlockDiscountTag, priceInfo.discount);

        if (dom.buyOnAmazonBtn) {
            var btnTextEl = utils.qs('.btn-text', dom.buyOnAmazonBtn);
            if (btnTextEl) {
                utils.setText(btnTextEl, 'Buy on ' + platformLabel);
            }
            utils.setAttr(dom.buyOnAmazonBtn, 'data-store', platform);
            utils.setAttr(dom.buyOnAmazonBtn, 'href', product.link || utils.buildStoreSearchUrl(platform, product.title));
        }

        document.dispatchEvent(new CustomEvent('crackshopping:searchResultsUpdated', {
            detail: { product: product, platform: platform }
        }));
    }

    function handleUrlSearch(detection) {
        var platform = detectPlatformFromUrl(detection.url);

        if (!platform) {
            hideUrlSearchResults();
            showSearchError('This link isn\'t from a supported store yet. Try Amazon, Flipkart, Meesho or Myntra.');
            return;
        }

        renderSearchResults({ valid: true, url: detection.url, platform: platform, reason: null });
    }

    function handleKeywordSearch(query) {
        hideUrlSearchResults();

        var productsApi = window.CrackShopping.products;
        if (!productsApi || typeof productsApi.applyKeywordSearch !== 'function') {
            return;
        }
        productsApi.applyKeywordSearch(query);
    }

    function handleSearchSubmit(event) {
        if (event) {
            event.preventDefault();
        }

        clearSearchError();

        // Jump to the very top instantly the moment a search is fired —
        // before results render — so the user is already at the top when
        // the new content appears, instead of the page appearing to slide.
        if (window.CrackShopping.navigation) {
            window.CrackShopping.navigation.scrollToTop();
        }

        if (!dom.productLinkInput) return;

        var detection = detectSearchMode(dom.productLinkInput.value);

        if (detection.mode === 'empty') {
            hideUrlSearchResults();
            showSearchError('Please enter a product name, keyword, or product link.');
            return;
        }

        if (detection.mode === 'url') {
            handleUrlSearch(detection);
            return;
        }

        handleKeywordSearch(detection.query);
    }

    utils.on(dom.productLinkSearchForm, 'submit', handleSearchSubmit);
    utils.on(dom.productLinkInput, 'input', clearSearchError);

    window.CrackShopping.search = {
        detectSearchMode: detectSearchMode,
        detectPlatformFromUrl: detectPlatformFromUrl,
        renderSearchResults: renderSearchResults,
        hideUrlSearchResults: hideUrlSearchResults,
        clearSearchError: clearSearchError,
        DEMO_SEARCHED_PRODUCT: DEMO_SEARCHED_PRODUCT
    };

});

/* ============================================================
   PART 4 — Category Filtering + Product Rendering
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;

    var PRODUCT_DATASET = window.CRACK_SHOPPING_PRODUCT_DATASET || [];

    // shareProductDetails lives in Part 1's scope, so it must be taken from
    // the shared utils object (this was the cause of the dead share buttons).
    var shareProductDetails = utils.shareProductDetails;

console.log(
    "[Crack Shopping] PRODUCT_DATASET connected:",
    PRODUCT_DATASET.length
);

    /* ============================================================
       KEYWORD / TEXT SEARCH ENGINE
       ============================================================
       This is an extensible Hindi + English intent map. Each entry
       lists every word (English and Hindi) that should trigger it.
       "categories" broadens recall to a whole PRODUCT_DATASET
       category (useful for Hindi words that never appear in any
       English title). "titleKeywords" are extra English substrings
       to look for directly inside product titles. To teach the
       search more words later, just add another entry here — no
       other code needs to change.
       ============================================================ */

    var KEYWORD_INTENTS = [
        {
            englishTerms: ['car', 'cars', 'toy car', 'vehicle', 'vehicles'],
            hindiTerms: ['कार', 'गाड़ी', 'गाड़ियां'],
            categories: ['vehicles']
        },
        {
            englishTerms: ['toy', 'toys'],
            hindiTerms: ['खिलौना', 'खिलौने', 'टॉय'],
            categories: ['toy']
        },
        {
            englishTerms: ['kitchen', 'kitchen set'],
            hindiTerms: ['किचन', 'रसोई'],
            categories: ['kitchen-set']
        },
        {
            englishTerms: ['headphone', 'headphones', 'earphone', 'earphones', 'earbud', 'earbuds'],
            hindiTerms: ['हेडफोन'],
            categories: ['headphones'],
            titleKeywords: ['headphone', 'earbud', 'earphone']
        },
        {
            englishTerms: ['electric', 'electronics', 'electronic'],
            hindiTerms: ['इलेक्ट्रॉनिक'],
            categories: ['electric']
        },
        {
            englishTerms: ['watch', 'watches', 'smartwatch', 'smartwatches'],
            hindiTerms: ['घड़ी', 'वॉच'],
            categories: ['smartwatches']
        },
        {
            englishTerms: ['clothes', 'clothing', 'cloth'],
            hindiTerms: ['कपड़े', 'कपड़ा'],
            categories: ['clothing']
        },
        {
            englishTerms: ['shoes', 'shoe', 'footwear'],
            hindiTerms: ['जूते', 'जूता'],
            categories: [],
            titleKeywords: ['shoe']
        },
        {
            englishTerms: ['mobile', 'phone', 'mobiles', 'phones', 'smartphone'],
            hindiTerms: ['मोबाइल', 'फोन'],
            categories: ['mobile-accessories']
        }
    ];

    function buildKeywordIndex() {
        var index = {};
        KEYWORD_INTENTS.forEach(function (intent) {
            var allTerms = (intent.englishTerms || []).concat(intent.hindiTerms || []);
            var titleTerms = (intent.titleKeywords || []).concat(intent.englishTerms || []);

            allTerms.forEach(function (term) {
                var key = utils.normalizeSearchText(term);
                if (!key) return;
                if (!index[key]) {
                    index[key] = { categories: [], titleKeywords: [] };
                }
                (intent.categories || []).forEach(function (categoryValue) {
                    if (index[key].categories.indexOf(categoryValue) === -1) {
                        index[key].categories.push(categoryValue);
                    }
                });
                titleTerms.forEach(function (titleTerm) {
                    var normalizedTitleTerm = utils.normalizeSearchText(titleTerm);
                    if (normalizedTitleTerm && index[key].titleKeywords.indexOf(normalizedTitleTerm) === -1) {
                        index[key].titleKeywords.push(normalizedTitleTerm);
                    }
                });
            });
        });
        return index;
    }

    var KEYWORD_INDEX = buildKeywordIndex();

    function escapeRegExpChars(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Matches "needle" against "haystack" only at the start of a word
    // (preceded by the string start or a non-alphanumeric character).
    // This lets a short stem like "earbud" correctly match "earbuds",
    // while stopping a generic term like "phone" from falsely matching
    // in the middle of an unrelated word like "headphones".
    function containsWordStart(haystack, needle) {
        if (!needle) return false;
        try {
            var pattern = new RegExp('(^|[^a-z0-9])' + escapeRegExpChars(needle), 'i');
            return pattern.test(haystack);
        } catch (err) {
            return haystack.indexOf(needle) !== -1;
        }
    }

    function expandQueryIntoSearchTerms(queryNormalized, queryTokens) {
        var categories = [];
        var titleTerms = [];

        function absorb(entry) {
            if (!entry) return;
            entry.categories.forEach(function (categoryValue) {
                if (categories.indexOf(categoryValue) === -1) categories.push(categoryValue);
            });
            entry.titleKeywords.forEach(function (titleTerm) {
                if (titleTerms.indexOf(titleTerm) === -1) titleTerms.push(titleTerm);
            });
        }

        absorb(KEYWORD_INDEX[queryNormalized]);
        queryTokens.forEach(function (token) {
            absorb(KEYWORD_INDEX[token]);
        });

        return { categories: categories, titleTerms: titleTerms };
    }

    function scoreProductForQuery(productItem, queryNormalized, queryTokens, expanded) {
        var title = utils.normalizeSearchText(productItem.title);
        var score = 0;

        if (queryNormalized && title === queryNormalized) {
            score = Math.max(score, 100);
        }
        if (queryNormalized && containsWordStart(title, queryNormalized)) {
            score = Math.max(score, 85);
        }
        queryTokens.forEach(function (token) {
            if (containsWordStart(title, token)) {
                score = Math.max(score, 70);
            }
        });
        expanded.titleTerms.forEach(function (titleTerm) {
            if (containsWordStart(title, titleTerm)) {
                score = Math.max(score, 65);
            }
        });
        (productItem.categories || []).forEach(function (categoryValue) {
            if (expanded.categories.indexOf(categoryValue) !== -1) {
                score = Math.max(score, 50);
            }
        });

        var idNormalized = utils.normalizeSearchText(productItem.id.replace(/-/g, ' '));
        var brandNormalized = utils.normalizeSearchText(productItem.brand);
        var storeNormalized = utils.normalizeSearchText(productItem.store);
        var weakTerms = queryTokens.concat(expanded.titleTerms);

        weakTerms.forEach(function (term) {
            if (!term) return;
            if (containsWordStart(idNormalized, term)) score = Math.max(score, 30);
            if (brandNormalized === term) score = Math.max(score, 25);
            if (storeNormalized === term) score = Math.max(score, 20);
        });

        return score;
    }

    function getProductsByKeyword(rawQuery) {
        var queryNormalized = utils.normalizeSearchText(rawQuery);
        if (!queryNormalized) return [];

        var queryTokens = queryNormalized.split(' ').filter(Boolean);
        var expanded = expandQueryIntoSearchTerms(queryNormalized, queryTokens);

        var scored = PRODUCT_DATASET.map(function (productItem) {
            return {
                product: productItem,
                score: scoreProductForQuery(productItem, queryNormalized, queryTokens, expanded)
            };
        }).filter(function (entry) {
            return entry.score > 0;
        });

        scored.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return (b.product.popularity || 0) - (a.product.popularity || 0);
        });

        return scored.map(function (entry) { return entry.product; });
    }

    function createProductCardElement(productItem) {
        var storeLabel = productItem.store.charAt(0).toUpperCase() + productItem.store.slice(1);

        var article = document.createElement('article');
        article.className = 'product-card';
        article.id = 'product-card-' + productItem.id;
        utils.setAttr(article, 'data-store', productItem.store);
        utils.setAttr(article, 'data-category', productItem.category || '');
        utils.setAttr(article, 'data-product-id', productItem.id);

        var top = document.createElement('div');
        top.className = 'product-card-top';

        var storeTag = document.createElement('img');
        storeTag.className = 'store-logo';
        utils.setAttr(storeTag, 'src', productItem.store + '.png');
        utils.setAttr(storeTag, 'alt', storeLabel);

        var discountTag = document.createElement('span');
        discountTag.className = 'discount-tag';
        utils.setText(discountTag, (productItem.discount === null || productItem.discount === undefined) ? '' : productItem.discount + '%');
        if (productItem.discount === null || productItem.discount === undefined) { discountTag.style.display = 'none'; }

        top.appendChild(storeTag);
        top.appendChild(discountTag);

        var imageWrapper = document.createElement('div');
        imageWrapper.className = 'product-image-wrapper';
        var img = document.createElement('img');
        img.className = 'product-image';
        img.setAttribute('src', productItem.image);
        img.setAttribute('alt', productItem.title);
        imageWrapper.appendChild(img);

        var info = document.createElement('div');
        info.className = 'product-info';

        var titleEl = document.createElement('h3');
        titleEl.className = 'product-title';
        utils.setText(titleEl, productItem.title);

        var pricing = document.createElement('div');
        pricing.className = 'product-pricing';
        var oldPriceEl = document.createElement('span');
        oldPriceEl.className = 'product-price-old';
        var hasPrice = productItem.price !== null && productItem.price !== undefined;
        var hasOld = productItem.oldPrice !== null && productItem.oldPrice !== undefined && hasPrice && productItem.oldPrice > productItem.price;
        utils.setText(oldPriceEl, hasOld ? utils.formatPrice(productItem.oldPrice) : '');
        var newPriceEl = document.createElement('span');
        newPriceEl.className = 'product-price-new';
        utils.setText(newPriceEl, hasPrice ? utils.formatPrice(productItem.price) : 'Check price on store');

        pricing.appendChild(oldPriceEl);
        pricing.appendChild(newPriceEl);

        info.appendChild(titleEl);
        info.appendChild(pricing);

        var viewDealBtn = document.createElement('button');
        viewDealBtn.type = 'button';
        viewDealBtn.className = 'view-deal-btn';
        viewDealBtn.id = 'view-deal-' + productItem.id;
        utils.setAttr(viewDealBtn, 'data-product-id', productItem.id);

        var btnArrow = document.createElement('span');
        btnArrow.className = 'view-deal-arrow';
        btnArrow.textContent = '\u2192';
        viewDealBtn.textContent = 'View Deal ';
        viewDealBtn.appendChild(btnArrow);

        var actionRow = document.createElement('div');
        actionRow.className = 'product-card-share-row';
        var shareBtn = document.createElement('button');
        shareBtn.type = 'button';
        shareBtn.className = 'product-share-btn card-product-share-btn';
        shareBtn.setAttribute('aria-label', 'Share ' + productItem.title);
        shareBtn.title = 'Share this product';
        shareBtn.setAttribute('data-share-product-id', productItem.id);
        shareBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3m0 0L7 8m5-5 5 5M5 13v7h14v-7"/></svg>';

        actionRow.appendChild(viewDealBtn);
        actionRow.appendChild(shareBtn);
        article.appendChild(top);
        article.appendChild(imageWrapper);
        article.appendChild(info);
        article.appendChild(actionRow);

        return article;
    }

    // One delegated listener handles share buttons on every product card,
    // including cards added later by filters and infinite scrolling.
    document.addEventListener('click', function (event) {
        var cardShare = event.target.closest ? event.target.closest('[data-share-product-id]') : null;
        if (cardShare) {
            event.preventDefault();
            event.stopPropagation();
            var productId = cardShare.getAttribute('data-share-product-id');
            var item = PRODUCT_DATASET.filter(function (product) { return product.id === productId; })[0];
            if (item) shareProductDetails(item, item.store);
            return;
        }
        var mainShare = event.target.closest ? event.target.closest('#main-product-share-btn') : null;
        if (mainShare) {
            event.preventDefault();
            var searched = window.CrackShopping && window.CrackShopping.state && window.CrackShopping.state.searchedProduct;
            if (searched && searched.product) {
                shareProductDetails(searched.product, searched.platform);
            } else {
                shareProductDetails({ title: document.getElementById('main-product-title')?.textContent || 'Crack Shopping product',
                    image: document.getElementById('main-product-image')?.getAttribute('src') || '',
                    price: null }, 'amazon');
            }
        }
    });

    function renderProductsIntoGrid(gridEl, productList, append, emptyMessage) {
        if (!gridEl) return;

        if (!append) {
            gridEl.textContent = '';
        }

        if (!productList.length && !append) {
            var emptyMsg = document.createElement('p');
            emptyMsg.className = 'no-results-message';
            utils.setText(emptyMsg, emptyMessage || 'No products found for this selection.');
            gridEl.appendChild(emptyMsg);
            return;
        }

        var fragment = document.createDocumentFragment();
        productList.forEach(function (productItem) {
            fragment.appendChild(createProductCardElement(productItem));
        });
        gridEl.appendChild(fragment);
    }

    function getProductsByCategory(categoryValue) {
        if (!categoryValue) {
            return PRODUCT_DATASET.slice();
        }
        return PRODUCT_DATASET.filter(function (item) {
            return (item.categories || [item.category]).indexOf(categoryValue) !== -1;
        });
    }

    // "Best Deals Right Now" is a fixed-size curated showcase row (matches
    // the blueprint's 6-card layout), not a full paginated listing — the
    // remaining matches for the active category/filters flow into the
    // "More Great Deals" infinite-scroll section instead (Part 5).
    var BEST_DEALS_DISPLAY_LIMIT = 6;

    function applyCategoryFilter(categoryValue) {
        // Browsing by category always supersedes an active keyword search —
        // clear the keyword state so the infinite-scroll pool (Part 5) goes
        // back to reading from the category, not stale keyword matches.
        state.activeSearchMode = 'category';
        state.activeKeywordQuery = '';

        state.activeCategory = categoryValue || '';
        state.deals.bestDealsRendered = 0;
        state.deals.isExhausted = false;

        var matched = getProductsByCategory(state.activeCategory);
        var showcased = matched.slice(0, BEST_DEALS_DISPLAY_LIMIT);
        renderProductsIntoGrid(dom.bestDealsGrid, showcased, false);
        state.deals.bestDealsRendered = showcased.length;

        // Track which product ids are already visible in the Best Deals
        // grid so the infinite-scroll "More Great Deals" pool (Part 5)
        // never renders the same product twice on the page.
        state.deals.currentlyDisplayedIds = showcased.map(function (item) { return item.id; });

        utils.qsa('.category-btn').forEach(function (btn) {
            var isActive = btn.getAttribute('data-category') === state.activeCategory && !!state.activeCategory;
            btn.classList.toggle('is-active', isActive);
            utils.setAttr(btn, 'aria-pressed', isActive ? 'true' : 'false');
        });

        document.dispatchEvent(new CustomEvent('crackshopping:categoryChanged', {
            detail: { category: state.activeCategory, count: matched.length }
        }));
    }

    // Renders a keyword/text search the same way applyCategoryFilter renders
    // a category: top matches go straight into the existing "Best Deals"
    // grid, the rest flow into the existing "More Great Deals" infinite
    // scroll (Part 5 reads state.activeSearchMode to know which pool to
    // pull from). No new sections, no scrollIntoView — results simply
    // replace what's already on screen right below the search bar.
    function applyKeywordSearch(rawQuery) {
        state.activeSearchMode = 'keyword';
        state.activeKeywordQuery = rawQuery;
        state.activeCategory = '';
        state.deals.bestDealsRendered = 0;
        state.deals.isExhausted = false;

        utils.qsa('.category-btn').forEach(function (btn) {
            btn.classList.remove('is-active');
            utils.setAttr(btn, 'aria-pressed', 'false');
        });

        var matched = getProductsByKeyword(rawQuery);
        var showcased = matched.slice(0, BEST_DEALS_DISPLAY_LIMIT);
        var emptyMessage = "No products found for '" + rawQuery.trim() + "'. Try another product or keyword.";
        renderProductsIntoGrid(dom.bestDealsGrid, showcased, false, emptyMessage);
        state.deals.bestDealsRendered = showcased.length;
        state.deals.currentlyDisplayedIds = showcased.map(function (item) { return item.id; });

        document.dispatchEvent(new CustomEvent('crackshopping:keywordSearchApplied', {
            detail: { query: rawQuery, count: matched.length }
        }));
    }

    function handleCategoryButtonClick(event) {
        var btn = event.currentTarget;
        var categoryValue = btn.getAttribute('data-category') || '';

        if (state.activeCategory === categoryValue) {
            applyCategoryFilter('');
        } else {
            applyCategoryFilter(categoryValue);
        }
    }

    utils.qsa('.category-btn').forEach(function (btn) {
        utils.on(btn, 'click', handleCategoryButtonClick);
    });

    document.addEventListener('crackshopping:homeReset', function () {
        applyCategoryFilter('');
    });

    window.CrackShopping.products = {
        PRODUCT_DATASET: PRODUCT_DATASET,
        BEST_DEALS_DISPLAY_LIMIT: BEST_DEALS_DISPLAY_LIMIT,
        createProductCardElement: createProductCardElement,
        renderProductsIntoGrid: renderProductsIntoGrid,
        getProductsByCategory: getProductsByCategory,
        getProductsByKeyword: getProductsByKeyword,
        applyCategoryFilter: applyCategoryFilter,
        applyKeywordSearch: applyKeywordSearch
    };

    // Render the initial "Best Deals Right Now" grid from the dataset
    // (replacing the static placeholder cards already in index.html) so
    // state.deals.currentlyDisplayedIds is correctly populated from the
    // very first paint — otherwise the infinite-scroll pool in Part 5
    // wouldn't know those first cards were already shown, and could
    // duplicate them into "More Great Deals" on initial page load.
    // If products.json has not arrived yet, the loader calls
    // applyCategoryFilter('') itself as soon as it does.
    if (PRODUCT_DATASET.length) {
        applyCategoryFilter('');
    }

});

/* ============================================================
   PART 5 — Infinite Scroll / More Deals
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var productsApi = window.CrackShopping.products;

    if (!productsApi) return;

    var PRODUCT_DATASET = productsApi.PRODUCT_DATASET;
    var renderProductsIntoGrid = productsApi.renderProductsIntoGrid;

    var MORE_DEALS_PAGE_SIZE = 4;
    var LOADING_DELAY_MS = 500;

    /**
     * Builds the eligible product pool for "More Great Deals", honoring
     * the same category AND advanced filters currently applied to the
     * Best Deals grid (Parts 4 & 6), sorted the same way — and excluding
     * every product id already rendered in the Best Deals grid so no
     * product ever appears twice on the page at the same time.
     */
    function getMoreDealsPool() {
        var basePool = (state.activeSearchMode === 'keyword' && typeof productsApi.getProductsByKeyword === 'function')
            ? productsApi.getProductsByKeyword(state.activeKeywordQuery)
            : productsApi.getProductsByCategory(state.activeCategory);
        var advancedFiltersApi = window.CrackShopping.advancedFilters;

        var pool = basePool;
        if (advancedFiltersApi && typeof advancedFiltersApi.productMatchesFilters === 'function') {
            pool = basePool.filter(function (productItem) {
                return advancedFiltersApi.productMatchesFilters(productItem, state.activeFilters);
            });
        }

        if (advancedFiltersApi && typeof advancedFiltersApi.sortProducts === 'function') {
            pool = advancedFiltersApi.sortProducts(pool, state.activeFilters.sortBy);
        }

        var excludedIds = state.deals.currentlyDisplayedIds || [];
        return pool.filter(function (productItem) {
            return excludedIds.indexOf(productItem.id) === -1;
        });
    }

    function showLoadingIndicator() {
        if (!dom.moreDealsGrid) return;
        var existing = utils.qs('#more-deals-loading-indicator');
        if (existing) return;

        var loadingEl = document.createElement('p');
        loadingEl.id = 'more-deals-loading-indicator';
        loadingEl.className = 'infinite-scroll-loading-text';
        utils.setText(loadingEl, 'Loading more deals...');
        dom.moreDealsGrid.appendChild(loadingEl);
    }

    function hideLoadingIndicator() {
        var existing = utils.qs('#more-deals-loading-indicator');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
    }

    function showEndOfResultsMessage() {
        if (!dom.moreDealsGrid) return;
        var existing = utils.qs('#more-deals-end-message');
        if (existing) return;

        var endEl = document.createElement('p');
        endEl.id = 'more-deals-end-message';
        endEl.className = 'infinite-scroll-end-text';
        utils.setText(endEl, "You've seen all deals for now. Check back soon for more!");
        dom.moreDealsGrid.appendChild(endEl);
    }

    function removeEndOfResultsMessage() {
        var existing = utils.qs('#more-deals-end-message');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
    }

    function loadMoreDeals() {
        if (state.deals.isLoading || state.deals.isExhausted) return;
        if (!dom.moreDealsGrid) return;

        state.deals.isLoading = true;
        showLoadingIndicator();

        window.setTimeout(function () {
            var pool = getMoreDealsPool();
            var startIndex = state.deals.moreDealsRendered;
            var nextBatch = pool.slice(startIndex, startIndex + MORE_DEALS_PAGE_SIZE);

            hideLoadingIndicator();

            if (nextBatch.length === 0) {
                state.deals.isExhausted = true;
                showEndOfResultsMessage();
                state.deals.isLoading = false;
                return;
            }

            renderProductsIntoGrid(dom.moreDealsGrid, nextBatch, true);
            if (dom.moreDealsScrollSentinel && dom.moreDealsGrid.lastElementChild !== dom.moreDealsScrollSentinel) {
                dom.moreDealsGrid.appendChild(dom.moreDealsScrollSentinel);
            }

            state.deals.moreDealsRendered = startIndex + nextBatch.length;

            if (state.deals.moreDealsRendered >= pool.length) {
                state.deals.isExhausted = true;
                showEndOfResultsMessage();
            }

            state.deals.isLoading = false;
        }, LOADING_DELAY_MS);
    }

    function resetInfiniteScroll() {
        state.deals.moreDealsRendered = 0;
        state.deals.isLoading = false;
        state.deals.isExhausted = false;
        removeEndOfResultsMessage();
        hideLoadingIndicator();

        if (dom.moreDealsGrid) {
            dom.moreDealsGrid.textContent = '';
            if (dom.moreDealsScrollSentinel) {
                dom.moreDealsGrid.appendChild(dom.moreDealsScrollSentinel);
            }
        }

        loadMoreDeals();
    }

    var scrollObserver = null;

    if ('IntersectionObserver' in window && dom.moreDealsScrollSentinel) {
        scrollObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    loadMoreDeals();
                }
            });
        }, {
            root: null,
            rootMargin: '200px 0px',
            threshold: 0
        });

        scrollObserver.observe(dom.moreDealsScrollSentinel);
    } else if (dom.moreDealsScrollSentinel) {
        var scrollFallbackHandler = utils.debounce(function () {
            var rect = dom.moreDealsScrollSentinel.getBoundingClientRect();
            var isNearViewport = rect.top <= window.innerHeight + 200;
            if (isNearViewport) {
                loadMoreDeals();
            }
        }, 150);
        utils.on(window, 'scroll', scrollFallbackHandler);
    }

    document.addEventListener('crackshopping:categoryChanged', function () {
        resetInfiniteScroll();
    });

    document.addEventListener('crackshopping:keywordSearchApplied', function () {
        resetInfiniteScroll();
    });

    document.addEventListener('crackshopping:homeReset', function () {
        resetInfiniteScroll();
    });

    loadMoreDeals();

    window.CrackShopping.infiniteScroll = {
        loadMoreDeals: loadMoreDeals,
        resetInfiniteScroll: resetInfiniteScroll
    };

});

/* ============================================================
   PART 6 — Advanced Filter Drawer
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var productsApi = window.CrackShopping.products;
    var navigationApi = window.CrackShopping.navigation;

    if (!productsApi) return;

    var renderProductsIntoGrid = productsApi.renderProductsIntoGrid;

    function toggleFilterDrawer() {
        if (!dom.categoryFilterDrawer || !dom.categoryFilterToggleBtn) return;
        var currentState = dom.categoryFilterDrawer.getAttribute('data-drawer-state');
        var nextState = currentState === 'open' ? 'closed' : 'open';
        utils.setAttr(dom.categoryFilterDrawer, 'data-drawer-state', nextState);
        utils.setAttr(dom.categoryFilterToggleBtn, 'aria-expanded', nextState === 'open' ? 'true' : 'false');
    }

    utils.on(dom.categoryFilterToggleBtn, 'click', toggleFilterDrawer);

    function bindSingleSelectGroup(groupSelector, stateKey) {
        var buttons = utils.qsa(groupSelector + ' .filter-option-btn');
        buttons.forEach(function (btn) {
            utils.on(btn, 'click', function () {
                var value = btn.getAttribute('data-value');
                var alreadyActive = btn.classList.contains('is-active');

                buttons.forEach(function (b) {
                    b.classList.remove('is-active');
                    utils.setAttr(b, 'aria-pressed', 'false');
                });

                if (alreadyActive) {
                    state.activeFilters[stateKey] = null;
                } else {
                    btn.classList.add('is-active');
                    utils.setAttr(btn, 'aria-pressed', 'true');
                    state.activeFilters[stateKey] = value;
                }
            });
        });
    }

    bindSingleSelectGroup('#price-range-options', 'price');
    bindSingleSelectGroup('#discount-range-options', 'discount');
    bindSingleSelectGroup('#rating-options', 'rating');

    utils.qsa('.color-swatch').forEach(function (swatch) {
        utils.on(swatch, 'click', function () {
            var value = swatch.getAttribute('data-value');
            var isActive = swatch.classList.toggle('is-active');
            var colors = state.activeFilters.colors;
            var idx = colors.indexOf(value);

            if (isActive && idx === -1) {
                colors.push(value);
            } else if (!isActive && idx !== -1) {
                colors.splice(idx, 1);
            }
        });
    });

    utils.qsa('.size-option-btn').forEach(function (btn) {
        utils.on(btn, 'click', function () {
            var value = btn.getAttribute('data-value');
            var isActive = btn.classList.toggle('is-active');
            var sizes = state.activeFilters.sizes;
            var idx = sizes.indexOf(value);

            if (isActive && idx === -1) {
                sizes.push(value);
            } else if (!isActive && idx !== -1) {
                sizes.splice(idx, 1);
            }
        });
    });

    function readCheckedValues(listSelector) {
        return utils.qsa(listSelector + ' input[type="checkbox"]:checked').map(function (checkbox) {
            return checkbox.value;
        });
    }

    function readSelectedSort() {
        var checkedRadio = utils.qs('#sort-by-radio-list input[type="radio"]:checked');
        return checkedRadio ? checkedRadio.value : 'popular';
    }

    var PRICE_RANGE_MAP = {
        'under-500': [0, 499],
        '500-1000': [500, 1000],
        '1000-2000': [1000, 2000],
        '2000-5000': [2000, 5000],
        '5000-10000': [5000, 10000],
        'above-10000': [10001, Infinity]
    };

    var DISCOUNT_RANGE_MAP = {
        '10-20': [10, 20],
        '20-30': [20, 30],
        '30-40': [30, 40],
        '40-50': [40, 50],
        '50-70': [50, 70],
        '70-plus': [70, Infinity]
    };

    function productMatchesFilters(productItem, filters) {
        var noPrice = (productItem.price === null || productItem.price === undefined);
        if ((filters.price || filters.discount) && (noPrice || productItem.discount === null)) {
            return false;
        }
        if (filters.price) {
            var priceRange = PRICE_RANGE_MAP[filters.price];
            if (priceRange && (productItem.price < priceRange[0] || productItem.price > priceRange[1])) {
                return false;
            }
        }

        if (filters.discount) {
            var discountRange = DISCOUNT_RANGE_MAP[filters.discount];
            if (discountRange && (productItem.discount < discountRange[0] || productItem.discount > discountRange[1])) {
                return false;
            }
        }

        if (filters.rating) {
            var minRating = parseFloat(filters.rating);
            if (productItem.rating < minRating) {
                return false;
            }
        }

        if (filters.brands.length && filters.brands.indexOf(productItem.brand) === -1 && filters.brands.indexOf(productItem.store) === -1) {
            return false;
        }

        if (filters.colors.length && filters.colors.indexOf(productItem.color) === -1) {
            return false;
        }

        if (filters.sizes.length && filters.sizes.indexOf(productItem.size) === -1) {
            return false;
        }

        if (filters.genders.length && filters.genders.indexOf(productItem.gender) === -1) {
            return false;
        }

        if (filters.offers.length) {
            var offerMatches = filters.offers.every(function (offerValue) {
                if (offerValue === 'free-delivery') return productItem.freeDelivery;
                if (offerValue === 'cash-on-delivery') return productItem.cod;
                if (offerValue === 'no-cost-emi') return productItem.emi;
                if (offerValue === 'bank-offer') return productItem.bankOffer;
                return true;
            });
            if (!offerMatches) return false;
        }

        if (filters.availability.length) {
            if (filters.availability.indexOf('in-stock') !== -1 && filters.availability.indexOf('out-of-stock') === -1) {
                // all demo products pass
            } else if (filters.availability.indexOf('out-of-stock') !== -1 && filters.availability.indexOf('in-stock') === -1) {
                return false;
            }
        }

        return true;
    }

    function sortProducts(productList, sortBy) {
        var sorted = productList.slice();

        switch (sortBy) {
            case 'low-to-high':
                sorted.sort(function (a, b) { return (a.price === null ? Infinity : a.price) - (b.price === null ? Infinity : b.price); });
                break;
            case 'high-to-low':
                sorted.sort(function (a, b) { return (b.price === null ? -1 : b.price) - (a.price === null ? -1 : a.price); });
                break;
            case 'discount':
                sorted.sort(function (a, b) { return (b.discount === null ? -1 : b.discount) - (a.discount === null ? -1 : a.discount); });
                break;
            case 'best-rated':
                sorted.sort(function (a, b) { return (b.rating || 0) - (a.rating || 0); });
                break;
            case 'newest-first':
                sorted.reverse();
                break;
            case 'popular':
            default:
                sorted.sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); });
                break;
        }

        return sorted;
    }

    function applyAdvancedFilters() {
        // The filter drawer always filters by category, so applying it
        // supersedes an active keyword search (same rule as clicking a
        // category quick-button) — keeps Part 5's infinite-scroll pool
        // reading from the right source afterwards.
        state.activeSearchMode = 'category';
        state.activeKeywordQuery = '';

        state.activeFilters.brands = readCheckedValues('#brand-checkbox-list');
        state.activeFilters.offers = readCheckedValues('#offers-checkbox-list');
        state.activeFilters.availability = readCheckedValues('#availability-checkbox-list');
        state.activeFilters.genders = readCheckedValues('#gender-checkbox-list');
        state.activeFilters.sortBy = readSelectedSort();

        var basePool = productsApi.getProductsByCategory(state.activeCategory);
        var filtered = basePool.filter(function (productItem) {
            return productMatchesFilters(productItem, state.activeFilters);
        });
        var sorted = sortProducts(filtered, state.activeFilters.sortBy);
        var displayLimit = productsApi.BEST_DEALS_DISPLAY_LIMIT || 6;
        var showcased = sorted.slice(0, displayLimit);

        renderProductsIntoGrid(dom.bestDealsGrid, showcased, false);

        // Keep the infinite-scroll "More Great Deals" pool aware of exactly
        // which products are already visible above it, so re-applying
        // filters never causes the same product to appear twice on the page.
        state.deals.currentlyDisplayedIds = showcased.map(function (item) { return item.id; });

        if (window.CrackShopping.infiniteScroll) {
            window.CrackShopping.infiniteScroll.resetInfiniteScroll();
        }

        toggleFilterDrawer();

        document.dispatchEvent(new CustomEvent('crackshopping:filtersApplied', {
            detail: { filters: state.activeFilters, count: sorted.length }
        }));
    }

    utils.on(dom.filterApplyBtn, 'click', applyAdvancedFilters);

    function handleClearAllFilters() {
        if (navigationApi) {
            navigationApi.resetAllFilters();
        }
        productsApi.applyCategoryFilter(state.activeCategory);

        if (window.CrackShopping.infiniteScroll) {
            window.CrackShopping.infiniteScroll.resetInfiniteScroll();
        }
    }

    utils.on(dom.filterClearAllBtn, 'click', handleClearAllFilters);

    window.CrackShopping.advancedFilters = {
        applyAdvancedFilters: applyAdvancedFilters,
        handleClearAllFilters: handleClearAllFilters,
        toggleFilterDrawer: toggleFilterDrawer,
        productMatchesFilters: productMatchesFilters,
        sortProducts: sortProducts
    };

});

/* ============================================================
   PART 7 — Product Comparison Modal
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var productsApi = window.CrackShopping.products;

    if (!productsApi) return;

    var PRODUCT_DATASET = productsApi.PRODUCT_DATASET;
    var ALL_STORES = ['amazon', 'flipkart', 'meesho', 'myntra'];

    function buildDemoComparisonPrices(productItem) {
        var basePrice = productItem.price;
        var baseOldPrice = productItem.oldPrice;
        var comparison = {};

        ALL_STORES.forEach(function (storeName, index) {
            if (storeName === productItem.store) {
                comparison[storeName] = {
                    price: basePrice,
                    oldPrice: baseOldPrice,
                    discount: productItem.discount + '% Off'
                };
                return;
            }

            var variationSteps = [0, 100, 51, 151];
            var variation = variationSteps[index % variationSteps.length];
            var demoPrice = basePrice + variation;
            var demoDiscountPercent = Math.max(
                0,
                Math.round(((baseOldPrice - demoPrice) / baseOldPrice) * 100)
            );

            comparison[storeName] = {
                price: demoPrice,
                oldPrice: baseOldPrice,
                discount: demoDiscountPercent + '% Off'
            };
        });

        return comparison;
    }

    function openProductComparisonModal(productItem) {
        if (!dom.productComparisonModal) return;

        var comparisonPrices = buildDemoComparisonPrices(productItem);
        state.activeComparisonProduct = {
            product: productItem,
            comparisonPrices: comparisonPrices
        };

        if (dom.modalProductImage) {
            dom.modalProductImage.setAttribute('src', productItem.image);
            dom.modalProductImage.setAttribute('alt', productItem.title);
        }
        utils.setText(dom.modalProductTitle, productItem.title);
        utils.setText(dom.modalRatingStars, '\u2605\u2605\u2605\u2605\u2606');
        utils.setText(dom.modalRatingValue, '(' + productItem.rating + ')');

        var priceRowConfig = [
            { store: 'amazon', priceId: 'modal-price-amazon', discountId: 'modal-discount-amazon' },
            { store: 'flipkart', priceId: 'modal-price-flipkart', discountId: 'modal-discount-flipkart' },
            { store: 'meesho', priceId: 'modal-price-meesho', discountId: 'modal-discount-meesho' },
            { store: 'myntra', priceId: 'modal-price-myntra', discountId: 'modal-discount-myntra' }
        ];

        priceRowConfig.forEach(function (config) {
            var storeData = comparisonPrices[config.store];
            if (!storeData) return;

            var priceEl = utils.qs('#' + config.priceId);
            var discountEl = utils.qs('#' + config.discountId);
            var rowEl = utils.qs('#modal-price-row-' + config.store);
            var actionBtn = rowEl ? utils.qs('.modal-store-action-btn', rowEl) : null;

            utils.setText(priceEl, utils.formatPrice(storeData.price));
            utils.setText(discountEl, storeData.discount);

            if (actionBtn) {
                utils.setAttr(actionBtn, 'href', utils.buildStoreSearchUrl(config.store, productItem.title));
            }
        });

        utils.setAttr(dom.productComparisonModal, 'data-modal-state', 'open');
        state.openModalId = 'product-comparison-modal';
        document.body.classList.add('modal-open');

        document.dispatchEvent(new CustomEvent('crackshopping:comparisonModalOpened', {
            detail: { product: productItem, comparisonPrices: comparisonPrices }
        }));
    }

    function closeProductComparisonModal() {
        if (!dom.productComparisonModal) return;
        utils.setAttr(dom.productComparisonModal, 'data-modal-state', 'closed');
        if (state.openModalId === 'product-comparison-modal') {
            state.openModalId = null;
            document.body.classList.remove('modal-open');
        }
        state.activeComparisonProduct = null;
    }

    function findProductById(productId) {
        for (var i = 0; i < PRODUCT_DATASET.length; i++) {
            if (PRODUCT_DATASET[i].id === productId) {
                return PRODUCT_DATASET[i];
            }
        }
        return null;
    }

    function handleProductGridClick(event) {
        // Share button inside a card must not open the product page.
        if (event.target.closest('[data-share-product-id]')) return;

        var viewDealBtn = event.target.closest('.view-deal-btn');
        var productCard = event.target.closest('.product-card');

        var productId = null;
        if (viewDealBtn) {
            productId = viewDealBtn.getAttribute('data-product-id');
        } else if (productCard) {
            productId = productCard.getAttribute('data-product-id');
        }

        if (!productId) return;

        event.preventDefault();

        var productItem = findProductById(productId);
        if (!productItem) {
            console.warn('Product not found in dataset for id:', productId);
            return;
        }

        var searchApi = window.CrackShopping.search;

if (searchApi && typeof searchApi.renderSearchResults === 'function') {
    searchApi.renderSearchResults({
        valid: true,
        url: new URL(
            'https://www.' + productItem.store + '.com/product/' + productItem.id
        ),
        platform: productItem.store,
        reason: null
    },productItem);
}
    }

    utils.on(dom.bestDealsGrid, 'click', handleProductGridClick);
    utils.on(dom.moreDealsGrid, 'click', handleProductGridClick);

    utils.on(dom.productComparisonModalClose, 'click', closeProductComparisonModal);

    utils.on(dom.productComparisonModal, 'click', function (event) {
        if (event.target === dom.productComparisonModal) {
            closeProductComparisonModal();
        }
    });

    utils.on(document, 'keydown', function (event) {
        if (event.key === 'Escape' && state.openModalId === 'product-comparison-modal') {
            closeProductComparisonModal();
        }
    });

    // Real <a href="..." target="_blank"> links now — only log for
    // analytics, don't preventDefault() or the redirect gets blocked.
    utils.qsa('.modal-store-action-btn').forEach(function (btn) {
        utils.on(btn, 'click', function () {
            var storeName = btn.getAttribute('data-store') || 'this store';
            console.info('[Crack Shopping] Redirecting to ' + storeName + ' affiliate link...');
        });
    });

    window.CrackShopping.comparisonModal = {
        openProductComparisonModal: openProductComparisonModal,
        closeProductComparisonModal: closeProductComparisonModal,
        findProductById: findProductById
    };

});

/* ============================================================
   PART 8 — Legal Modals + Contact Modal
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;

    var MODAL_REGISTRY = {
        'privacy-policy-modal': dom.privacyPolicyModal,
        'terms-conditions-modal': dom.termsConditionsModal,
        'affiliate-disclaimer-modal': dom.affiliateDisclaimerModal,
        'contact-modal': dom.contactModal
    };

    var MODAL_CLOSE_BUTTONS = {
        'privacy-policy-modal': dom.privacyPolicyModalClose,
        'terms-conditions-modal': dom.termsConditionsModalClose,
        'affiliate-disclaimer-modal': dom.affiliateDisclaimerModalClose,
        'contact-modal': dom.contactModalClose
    };

    function openModalById(modalId) {
        var modalEl = MODAL_REGISTRY[modalId];
        if (!modalEl) {
            console.warn('No modal registered for id:', modalId);
            return;
        }

        if (window.CrackShopping.comparisonModal) {
            window.CrackShopping.comparisonModal.closeProductComparisonModal();
        }

        utils.setAttr(modalEl, 'data-modal-state', 'open');
        state.openModalId = modalId;
        document.body.classList.add('modal-open');
    }

    function closeModalById(modalId) {
        var modalEl = MODAL_REGISTRY[modalId];
        if (!modalEl) return;

        utils.setAttr(modalEl, 'data-modal-state', 'closed');
        if (state.openModalId === modalId) {
            state.openModalId = null;
            document.body.classList.remove('modal-open');
        }
    }

    function closeCurrentlyOpenLegalModal() {
        if (state.openModalId && MODAL_REGISTRY[state.openModalId]) {
            closeModalById(state.openModalId);
        }
    }

    function handleModalTriggerClick(event) {
        var trigger = event.target.closest('[data-modal-target]');
        if (!trigger) return;

        var targetId = trigger.getAttribute('data-modal-target');

        if (!targetId || targetId === 'none') return;

        event.preventDefault();
        openModalById(targetId);
    }

    utils.on(document, 'click', handleModalTriggerClick);

    Object.keys(MODAL_CLOSE_BUTTONS).forEach(function (modalId) {
        var closeBtn = MODAL_CLOSE_BUTTONS[modalId];
        utils.on(closeBtn, 'click', function () {
            closeModalById(modalId);
        });
    });

    Object.keys(MODAL_REGISTRY).forEach(function (modalId) {
        var modalEl = MODAL_REGISTRY[modalId];
        utils.on(modalEl, 'click', function (event) {
            if (event.target === modalEl) {
                closeModalById(modalId);
            }
        });
    });

    utils.on(document, 'keydown', function (event) {
        if (event.key === 'Escape' && state.openModalId && MODAL_REGISTRY[state.openModalId]) {
            closeModalById(state.openModalId);
        }
    });

    document.addEventListener('crackshopping:homeReset', function () {
        closeCurrentlyOpenLegalModal();
    });

    window.CrackShopping.legalModals = {
        openModalById: openModalById,
        closeModalById: closeModalById,
        closeCurrentlyOpenLegalModal: closeCurrentlyOpenLegalModal,
        MODAL_REGISTRY: MODAL_REGISTRY
    };

});

/* ============================================================
   PART 9 — Search Results + Comparison State + UI Synchronization
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var searchApi = window.CrackShopping.search;

    if (!searchApi) return;

    var COMPARISON_CARD_CONFIG = [
        { store: 'amazon', cardEl: dom.comparisonCardAmazon },
        { store: 'flipkart', cardEl: dom.comparisonCardFlipkart },
        { store: 'meesho', cardEl: dom.comparisonCardMeesho },
        { store: 'myntra', cardEl: dom.comparisonCardMyntra }
    ];

    /* ------------------------------------------------------------
       "View on <Store>" buttons pehle pura dead the (koi listener
       hi nahi tha). Ab modal ke buttons jaisa hi consistent demo
       behaviour de rahe hain, jab tak real affiliate redirect
       integrate nahi hota.
       ------------------------------------------------------------ */
    // These buttons are real <a href="..." target="_blank"> links now, so
    // clicking them opens the store's website in a new tab on its own —
    // we only log here for analytics, and must NOT call preventDefault(),
    // or the redirect would be blocked again.
    utils.on(dom.priceComparisonGrid, 'click', function (event) {
        var storeBtn = event.target.closest('.view-on-store-btn');
        if (!storeBtn) return;
        var storeName = storeBtn.getAttribute('data-store') || 'this store';
        console.info('[Crack Shopping] Redirecting to ' + storeName + ' affiliate link...');
    });

    utils.on(dom.buyOnAmazonBtn, 'click', function () {
        var storeName = dom.buyOnAmazonBtn.getAttribute('data-store') || 'this store';
        console.info('[Crack Shopping] Redirecting to ' + storeName + ' affiliate link...');
    });

    function updateComparisonCard(cardEl, storeName, storeData, lowestPrice, productTitle, productImage) {
        if (!cardEl) return;

        var priceCurrentEl = utils.qs('.comparison-price-current', cardEl);
        var priceOldEl = utils.qs('.comparison-price-old', cardEl);
        var titleEl = utils.qs('.comparison-card-title', cardEl);
        var diffTagEl = utils.qs('.comparison-price-diff-tag', cardEl);
        var discountTagEl = utils.qs('.discount-tag', cardEl);
        var imageEl = utils.qs('.comparison-card-image', cardEl);
        var storeActionBtn = utils.qs('.view-on-store-btn', cardEl);

        utils.setText(priceCurrentEl, utils.formatPrice(storeData.price));
        utils.setText(priceOldEl, utils.formatPrice(storeData.oldPrice));
        utils.setText(titleEl, productTitle);
        utils.setText(discountTagEl, storeData.discount);

        if (storeActionBtn) {
            utils.setAttr(storeActionBtn, 'href', utils.buildStoreSearchUrl(storeName, productTitle));
        }

        if (imageEl && productImage) {
            imageEl.setAttribute('src', productImage);
            imageEl.setAttribute('alt', productTitle);
        }

        if (storeData.price === lowestPrice) {
            utils.setText(diffTagEl, 'Sabse Sasta Deal');
            diffTagEl.classList.add('comparison-price-diff-lowest');
        } else {
            var difference = storeData.price - lowestPrice;
            utils.setText(diffTagEl, utils.formatPrice(difference) + ' Mehnga');
            diffTagEl.classList.remove('comparison-price-diff-lowest');
        }
    }

    function syncComparisonGridWithSearchedProduct(product, prices) {
        var allPrices = COMPARISON_CARD_CONFIG.map(function (config) {
            return prices[config.store] ? prices[config.store].price : Infinity;
        });
        var lowestPrice = Math.min.apply(null, allPrices);

        COMPARISON_CARD_CONFIG.forEach(function (config) {
            var storeData = prices[config.store];
            if (!storeData) return;
            updateComparisonCard(config.cardEl, config.store, storeData, lowestPrice, product.title, product.image);
        });
    }

    document.addEventListener('crackshopping:searchResultsUpdated', function (event) {
        var detail = event.detail || {};
        if (!detail.product || !detail.product.prices) return;
        syncComparisonGridWithSearchedProduct(detail.product, detail.product.prices);
    });

    document.addEventListener('crackshopping:categoryChanged', function () {
        if (state.searchedProduct && dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'hidden');
            state.searchedProduct = null;
            searchApi.clearSearchError();
            if (window.CrackShopping.navigation) {
                window.CrackShopping.navigation.setHeroTextVisibility(true);
            }
        }
    });

    document.addEventListener('crackshopping:keywordSearchApplied', function () {
        if (state.searchedProduct && dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'hidden');
            state.searchedProduct = null;
            searchApi.clearSearchError();
            if (window.CrackShopping.navigation) {
                window.CrackShopping.navigation.setHeroTextVisibility(true);
            }
        }
    });

    document.addEventListener('crackshopping:filtersApplied', function () {
        if (state.searchedProduct && dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'hidden');
            state.searchedProduct = null;
            if (window.CrackShopping.navigation) {
                window.CrackShopping.navigation.setHeroTextVisibility(true);
            }
        }
    });

    function clearSelectedProductCardHighlight() {
        utils.qsa('.product-card.is-selected-in-modal').forEach(function (cardEl) {
            cardEl.classList.remove('is-selected-in-modal');
        });
    }

    document.addEventListener('crackshopping:comparisonModalOpened', function (event) {
        clearSelectedProductCardHighlight();
        var detail = event.detail || {};
        if (!detail.product) return;

        var cardEl = utils.qs('#product-card-' + detail.product.id);
        if (cardEl) {
            cardEl.classList.add('is-selected-in-modal');
        }
    });

    document.addEventListener('crackshopping:homeReset', function () {
        clearSelectedProductCardHighlight();

        if (window.CrackShopping.comparisonModal) {
            window.CrackShopping.comparisonModal.closeProductComparisonModal();
        }

        searchApi.clearSearchError();
    });

    function getCurrentAppSnapshot() {
        return {
            activeCategory: state.activeCategory,
            activeFilters: state.activeFilters,
            searchedProduct: state.searchedProduct,
            activeComparisonProduct: state.activeComparisonProduct,
            openModalId: state.openModalId,
            deals: state.deals
        };
    }

    window.CrackShopping.sync = {
        syncComparisonGridWithSearchedProduct: syncComparisonGridWithSearchedProduct,
        clearSelectedProductCardHighlight: clearSelectedProductCardHighlight,
        getCurrentAppSnapshot: getCurrentAppSnapshot
    };

});

/* ============================================================
   PART 10 — Final Integration + Error Handling + Performance
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;

    function auditMissingElements() {
        var missing = [];
        Object.keys(dom).forEach(function (key) {
            if (!dom[key]) {
                missing.push(key);
            }
        });

        if (missing.length) {
            console.warn(
                '[Crack Shopping] The following expected elements were not found in the DOM ' +
                '(related functionality will be safely skipped):',
                missing
            );
        }
    }

    auditMissingElements();

    var allModalOverlays = utils.qsa('.modal-overlay');

    function isAnyModalOpen() {
        return allModalOverlays.some(function (modalEl) {
            return modalEl.getAttribute('data-modal-state') === 'open';
        });
    }

    function syncBodyScrollLock() {
        document.body.classList.toggle('modal-open', isAnyModalOpen());
    }

    if ('MutationObserver' in window && allModalOverlays.length) {
        var modalObserver = new MutationObserver(function (mutations) {
            var relevant = mutations.some(function (mutation) {
                return mutation.attributeName === 'data-modal-state';
            });
            if (relevant) {
                syncBodyScrollLock();
            }
        });

        allModalOverlays.forEach(function (modalEl) {
            modalObserver.observe(modalEl, { attributes: true, attributeFilter: ['data-modal-state'] });
        });
    }

    utils.on(document, 'keydown', function (event) {
        if (event.key !== 'Escape') return;
        if (!state.openModalId) return;

        var stillOpenModal = utils.qs('#' + state.openModalId + '[data-modal-state="open"]');
        if (stillOpenModal) {
            utils.setAttr(stillOpenModal, 'data-modal-state', 'closed');
            state.openModalId = null;
            syncBodyScrollLock();
        }
    });

    utils.on(document, 'click', function (event) {
        if (!dom.categoryFilterDrawer || !dom.categoryFilterToggleBtn) return;
        var isOpen = dom.categoryFilterDrawer.getAttribute('data-drawer-state') === 'open';
        if (!isOpen) return;

        var clickedInsideDrawer = dom.categoryFilterDrawer.contains(event.target);
        var clickedToggleBtn = dom.categoryFilterToggleBtn.contains(event.target);

        if (!clickedInsideDrawer && !clickedToggleBtn) {
            utils.setAttr(dom.categoryFilterDrawer, 'data-drawer-state', 'closed');
            utils.setAttr(dom.categoryFilterToggleBtn, 'aria-expanded', 'false');
        }
    });

    document.addEventListener('crackshopping:filtersApplied', function (event) {
        var detail = event.detail || {};
        if (detail.count === 0 && dom.bestDealsGrid) {
            var existingMsg = utils.qs('.no-results-message', dom.bestDealsGrid);
            if (existingMsg) {
                var hintEl = document.createElement('p');
                hintEl.className = 'no-results-hint';
                utils.setText(hintEl, 'Try adjusting or clearing your filters to see more deals.');
                existingMsg.insertAdjacentElement('afterend', hintEl);
            }
        }
    });

    var MAX_SEARCH_INPUT_LENGTH = 2048;

    utils.on(dom.productLinkInput, 'input', function () {
        if (dom.productLinkInput.value.length > MAX_SEARCH_INPUT_LENGTH) {
            dom.productLinkInput.value = dom.productLinkInput.value.slice(0, MAX_SEARCH_INPUT_LENGTH);
        }
    });

    window.addEventListener('error', function (event) {
        console.error('[Crack Shopping] Unexpected error caught:', event.message, event.error || '');
    });

    window.addEventListener('unhandledrejection', function (event) {
        console.error('[Crack Shopping] Unhandled promise rejection:', event.reason);
    });

    var handleWindowResize = utils.debounce(function () {
        document.dispatchEvent(new CustomEvent('crackshopping:windowResized', {
            detail: { width: window.innerWidth, height: window.innerHeight }
        }));
    }, 200);

    utils.on(window, 'resize', handleWindowResize);

    console.info(
        '[Crack Shopping] Application initialized successfully in static/demo mode. ' +
        'No live API or affiliate integration is active yet.'
    );

});

/* ============================================================
   PART 11 — SEO: DYNAMIC JSON-LD PRODUCT SCHEMA
   (Amazon, Flipkart, Meesho, Myntra)

   Reads products.json and injects one <script type="application/ld+json">
   ItemList (of Product/Offer objects) per store into <head>, so search
   engines see structured product data that always matches what's in
   products.json — no manual schema editing required when prices change.
   ============================================================ */

(function () {

    // Path to your product data file (relative to index.html) is the
    // global PRODUCTS_JSON_URL defined at the top of this file.

    // Where product images live, relative to index.html. Update this if
    // your image files (a01.jpg, F01.webp, m02.png, me01.png, etc.) are
    // stored in a different folder.
    var IMAGE_BASE_PATH = 'assets/products/';

    // Fallback image (used when a product has no "image" in products.json,
    // e.g. the Meesho headphones entry).
    var FALLBACK_IMAGE = 'crack-shopping.png';

    var STORE_LABELS = {
        amazon: 'Amazon',
        flipkart: 'Flipkart',
        meesho: 'Meesho',
        myntra: 'Myntra'
    };

    function resolveUrl(relativePath) {
        try {
            return new URL(relativePath, window.location.href).toString();
        } catch (err) {
            return relativePath;
        }
    }

    function resolveImageUrl(imageFile) {
    if (!imageFile) { return resolveUrl(FALLBACK_IMAGE); }
    if (/^https?:\/\//i.test(imageFile)) { return imageFile; }
    return resolveUrl(IMAGE_BASE_PATH + imageFile);
    }

    // Builds one schema.org Product node (with a nested Offer) for a single
    // product entry from products.json.
    function buildProductSchema(item, storeKey) {
        var storeName = STORE_LABELS[storeKey] || storeKey;
        var hasLivePrice = (item.price !== null && item.price !== undefined);
        var effectivePrice = hasLivePrice ? item.price : item.mrp;
        var availability = hasLivePrice
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock';

        var schema = {
            '@type': 'Product',
            'name': item.name,
            'image': [resolveImageUrl(item.image)],
            'url': item.link,
            'offers': {
                '@type': 'Offer',
                'url': item.link,
                'priceCurrency': 'INR',
                'price': effectivePrice,
                'availability': availability,
                'itemCondition': 'https://schema.org/NewCondition',
                'seller': {
                    '@type': 'Organization',
                    'name': storeName
                }
            }
        };

        if (item.category) {
            schema.category = item.category;
        }

        return schema;
    }

    // Wraps a store's products into a schema.org ItemList so each store's
    // deals are grouped under one JSON-LD block.
    function buildItemListSchema(storeKey, items) {
        var storeName = STORE_LABELS[storeKey] || storeKey;
        return {
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            'name': 'Crack Shopping \u2013 Best ' + storeName + ' Deals',
            'itemListElement': items.map(function (item, index) {
                return {
                    '@type': 'ListItem',
                    'position': index + 1,
                    'item': buildProductSchema(item, storeKey)
                };
            })
        };
    }

    // Creates (or replaces) a <script type="application/ld+json"> tag in <head>.
    function injectJsonLd(id, dataObject) {
        var existing = document.getElementById(id);
        if (existing) {
            existing.remove();
        }

        var scriptEl = document.createElement('script');
        scriptEl.type = 'application/ld+json';
        scriptEl.id = id;
        scriptEl.textContent = JSON.stringify(dataObject);
        document.head.appendChild(scriptEl);
    }

    function renderAllStoreSchemas(productsData) {
        Object.keys(STORE_LABELS).forEach(function (storeKey) {
            var items = productsData[storeKey];
            if (!items || !items.length) return;
            var listSchema = buildItemListSchema(storeKey, items);
            injectJsonLd('jsonld-products-' + storeKey, listSchema);
        });
    }

    function loadProductsAndInjectSchema() {
        if (!window.fetch) return; // very old browsers: skip gracefully

        fetch(PRODUCTS_JSON_URL, { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('products.json request failed with status ' + response.status);
                }
                return response.json();
            })
            .then(function (productsData) {
                renderAllStoreSchemas(productsData);
            })
            .catch(function (err) {
                // Fails silently for the visitor; logged for the developer.
                // Common cause: opening index.html directly as a file:// URL
                // instead of serving it from a local/live web server.
                console.warn('[Crack Shopping] Could not load products.json for SEO schema:', err);
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadProductsAndInjectSchema);
    } else {
        loadProductsAndInjectSchema();
    }

})();

/* ============================================================
   PART 12 — Shared-link landing (?product=<id>)
   A shared link always lands on Crack Shopping first and opens the
   product's comparison page. From there the visitor chooses the store
   (Amazon / Flipkart / Meesho / Myntra). If the id is missing or wrong,
   the normal home page is shown.
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var sharedId = '';
    try {
        sharedId = new URLSearchParams(window.location.search).get('product') || '';
    } catch (e) {}
    if (!sharedId) return;

    function openSharedProduct() {
        var dataset = window.CRACK_SHOPPING_PRODUCT_DATASET || [];
        var item = null;
        for (var i = 0; i < dataset.length; i++) {
            if (dataset[i].id === sharedId) { item = dataset[i]; break; }
        }
        var searchApi = window.CrackShopping && window.CrackShopping.search;
        if (!item || !searchApi || typeof searchApi.renderSearchResults !== 'function') return; // fall back to home page

        searchApi.renderSearchResults({
            valid: true,
            url: new URL('https://www.' + item.store + '.com/product/' + item.id),
            platform: item.store,
            reason: null
        }, item);
    }

    var ready = window.CRACK_SHOPPING_PRODUCTS_READY;
    if (ready && typeof ready.then === 'function') {
        ready.then(openSharedProduct);
    } else {
        openSharedProduct();
    }
});