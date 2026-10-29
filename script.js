/* ============================================================
   CRACK SHOPPING - Load products.json  (single loader)
   ------------------------------------------------------------
   - products.json ek baar load hota hai (HTTP cache revalidate).
   - Har outgoing link URL-cleaner se saaf hota hai (purane / galat
     tracking parameters hatte hain, sahi affiliate params lagte hain).
   - Ab koi dummy / nakli comparison price nahi banta. Dusre store par
     product tabhi dikhta hai jab woh sach me us store ke data me ho
     (matching logic: CrackShoppingEngine.findStoreMatches).
   ============================================================ */

var PRODUCTS_JSON_URL = 'products.json';

window.CRACK_SHOPPING_PRODUCT_DATASET = [];

/* ------------------------------------------------------------
   SITE CONFIG  (yahin se settings badlein)
   ------------------------------------------------------------ */
window.CRACK_SHOPPING_CONFIG = {
    // Dusre store par "same product" maanne ke liye minimum similarity (0-1).
    // Zyada = sakht (kam, par pakke matches). Kam = zyada matches, galat match ka risk.
    COMPARE_MIN_SIMILARITY: 0.6,

    // Smart Comparison ke 3 sakht niyam (findStoreMatches):
    //  1) category + subcategory bilkul same
    //  2) naam ke kam se kam 65% shabd match (60-70% ka range)
    //  3) keemat me 20% se zyada fark nahi
    COMPARE_MIN_NAME_MATCH: 0.65,
    COMPARE_MAX_PRICE_DIFF: 0.2,

    // Ek baar me kitne "Suggested Products" load hon (infinite scroll).
    SUGGESTIONS_PAGE_SIZE: 12,

    // Affiliate parameters. KHALI ('') chhodne par link bilkul saaf (clean) jaata hai
    // aur Cuelinks (cuelinksv2.js) click par use khud monetize kar deta hai.
    // Agar kisi store ke liye seedha apna tag lagana hai to yahan bharein, jaise:
    //   amazon:   { tag: 'yourtag-21' }
    //   flipkart: { affid: 'yourflipkartid' }
    AFFILIATE: {
        amazon:   { tag: '' },
        flipkart: { affid: '' },
        meesho:   {},
        myntra:   {}
    }
};

/* ------------------------------------------------------------
   URL CLEANER + TRACKING SANITIZER
   ------------------------------------------------------------ */
window.CRACK_SHOPPING_URL = (function () {

    var CONFIG = window.CRACK_SHOPPING_CONFIG;

    var STORE_HOSTS = [
        ['amazon',   /(^|\.)(amazon\.[a-z.]+|amzn\.(in|to|com|eu))$/i],
        ['flipkart', /(^|\.)(flipkart\.com|fkrt\.(it|cc|in))$/i],
        ['meesho',   /(^|\.)meesho\.com$/i],
        ['myntra',   /(^|\.)myntra\.com$/i]
    ];

    // Jin parameters ko hum hamesha hata dete hain (kisi bhi aise store ke liye
    // jiska "keep-list" neeche define nahi hai).
    var TRACKING_PARAM = /^(utm_.*|fbclid|gclid|dclid|msclkid|yclid|igshid|mc_cid|mc_eid|srsltid|ref|ref_|tag|linkcode|linkid|creative|creativeasin|camp|ascsubtag|aff.*|otracker.*|cuelinks.*|cid|clickid|irclickid|subid\d*|source|campaign|medium|share_id|cmpid|sid|pf_rd_.*|pd_rd_.*|qid|sr|crid|sprefix|keywords)$/i;

    var ASIN_RE = /(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/|\/gp\/offer-listing\/|\/product\/)([A-Z0-9]{10})(?=[/?#]|$)/i;

    function detectStoreFromHost(host) {
        for (var i = 0; i < STORE_HOSTS.length; i++) {
            if (STORE_HOSTS[i][1].test(host || '')) return STORE_HOSTS[i][0];
        }
        return '';
    }

    function parseUrl(raw) {
        var s = String(raw == null ? '' : raw).trim();
        if (!s) return null;
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) {
            if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) {
                s = 'https://' + s;
            } else {
                return null;
            }
        }
        var u;
        try { u = new URL(s); } catch (e) { return null; }
        // javascript:, data:, file: etc. kabhi allow nahi
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
        return u;
    }

    // Product link ko saaf karta hai. Galat / khaali / unsafe link par '' deta hai.
    function cleanProductUrl(raw, storeHint) {
        var u = parseUrl(raw);
        if (!u) return '';
        u.protocol = 'https:';
        u.hash = '';
        u.username = '';
        u.password = '';

        var store = detectStoreFromHost(u.hostname) || storeHint || '';
        var keep = null;   // null => sirf generic tracking hatao; array => sirf yehi parameters rakho

        if (store === 'amazon') {
            var m = u.pathname.match(ASIN_RE);
            if (m) { u.pathname = '/dp/' + m[1].toUpperCase(); }
            keep = [];
        } else if (store === 'flipkart') {
            keep = /\/p\/itm/i.test(u.pathname) ? ['pid', 'lid'] : [];
        } else if (store === 'meesho' || store === 'myntra') {
            keep = [];
        }

        Array.from(u.searchParams.keys()).forEach(function (key) {
            var lower = key.toLowerCase();
            var drop = keep ? keep.indexOf(lower) === -1 : TRACKING_PARAM.test(lower);
            if (drop) u.searchParams.delete(key);
        });

        return u.toString();
    }

    // Config me bhare sahi affiliate parameters lagata hai (khaali ho to kuch nahi).
    function applyAffiliateParams(urlStr, store) {
        var cfg = (CONFIG.AFFILIATE || {})[store];
        if (!cfg || !urlStr) return urlStr;
        try {
            var u = new URL(urlStr);
            var changed = false;
            Object.keys(cfg).forEach(function (key) {
                if (cfg[key]) { u.searchParams.set(key, cfg[key]); changed = true; }
            });
            return changed ? u.toString() : urlStr;
        } catch (e) {
            return urlStr;
        }
    }

    function sanitizeOutgoingUrl(raw, storeHint) {
        var cleaned = cleanProductUrl(raw, storeHint);
        if (!cleaned) return '';
        var store = detectStoreFromHost(new URL(cleaned).hostname) || storeHint || '';
        return applyAffiliateParams(cleaned, store);
    }

    // Pasted / stored link se ek "product key" nikalta hai (store + product id),
    // taaki pasted link ko dataset ke product se milaya ja sake.
    function productKeyFromUrl(raw) {
        var u = parseUrl(raw);
        if (!u) return '';
        var store = detectStoreFromHost(u.hostname);
        var path = u.pathname;
        var m;
        if (store === 'amazon') {
            m = path.match(ASIN_RE);
            if (m) return 'amazon:' + m[1].toUpperCase();
            return 'amazon:path:' + path.toLowerCase();
        }
        if (store === 'flipkart') {
            m = path.match(/\/p\/(itm[a-z0-9]+)/i);
            if (m) return 'flipkart:' + m[1].toLowerCase();
            var pid = u.searchParams.get('pid');
            if (pid) return 'flipkart:pid:' + pid.toLowerCase();
            return 'flipkart:path:' + path.toLowerCase();
        }
        if (store === 'meesho') {
            m = path.match(/\/p\/([a-z0-9]+)\/?$/i);
            if (m) return 'meesho:' + m[1].toLowerCase();
            return 'meesho:path:' + path.toLowerCase();
        }
        if (store === 'myntra') {
            m = path.match(/\/(\d{5,})(?:\/buy)?\/?$/);
            if (m) return 'myntra:' + m[1];
            return 'myntra:path:' + path.toLowerCase();
        }
        return '';
    }

    return {
        clean: cleanProductUrl,
        sanitize: sanitizeOutgoingUrl,
        detectStore: detectStoreFromHost,
        productKey: productKeyFromUrl,
        parse: parseUrl
    };
})();

(function () {

    var STORE_ORDER = ['amazon', 'flipkart', 'meesho', 'myntra'];
    var URLS = window.CRACK_SHOPPING_URL;

    // products.json category text -> category buttons (toy / electric / vehicles / kitchen-set)
    var CATEGORY_MAP = {
        'headphones / audio': { primary: 'headphones', groups: ['electric'] },
        'smartwatches': { primary: 'smartwatches', groups: ['electric'] },
        'mobile accessories': { primary: 'mobile-accessories', groups: ['electric'] },
        'bile accessories': { primary: 'mobile-accessories', groups: ['electric'] }, // typo in Meesho entry
        'kitchen appliances': { primary: 'kitchen-set', groups: [] },
        'toys': { primary: 'toy', groups: [] }
    };

    // products.json me ab 100+ alag category-naam hain; unhe button-groups me jodne ke rules.
    var GROUP_RULES = [
        // Quick buttons: Mobile (sirf smartphones/mobiles, accessories nahi) aur Clothing (Men/Women/Kids Clothing)
        { group: 'mobiles',     re: /^(mobiles?|smartphones?)$/i },
        { group: 'clothing',    re: /clothing/i },
        { group: 'toy',         re: /toy|game/i },
        { group: 'vehicles',    re: /toy ?car|toycar|vehicle|die-?cast/i },
        { group: 'kitchen-set', re: /kitchen|chopper|container|\bjars?\b|lunch|peeler|grater|bottle|flask|thermos|\bcups?\b|\bmugs?\b|mixer/i },
        { group: 'electric',    re: /earbud|earphone|headphone|audio|charger|charging|cable|mobile|phone|smartwatch|usb|pen ?drive|pendrive|extension|spike|mouse|keyboard|laptop|power ?bank|hard disk|trimmer|shaver|dryer|straightener|tempered|screen|popsocket/i }
    ];

    // "Same category" ke liye alag-alag stores ke category-naam ek "family" me.
    // (Amazon 'Toy Cars' = Flipkart 'toycar' = Meesho 'Die-Cast & Toy Vehicles' = Myntra 'Toy Vehicles')
    var FAMILY_RULES = [
        // Clothing sabse pehle: warna "clothing" label ke andar ka "cloth" use 'cleaning' family me daal deta tha
        [/clothing|apparel|garment|kurt[aiy]|saree|t-?shirt|jeans|dress/i, 'clothing'],
        [/toy ?car|toycar|toy vehicle|die-?cast|remote control car/i, 'toy-vehicles'],
        [/toy|game/i, 'toys'],
        [/smartwatch|smart watch/i, 'smartwatches'],
        [/earbud|earphone|headphone|audio/i, 'audio'],
        [/^(mobiles?|smartphones?)$/i, 'mobiles'],                 // Amazon 'Mobiles' = Flipkart/Meesho 'Smartphones'
        [/(mobile|bile|phone)\s*accessor/i, 'mobile-accessories'],   // phone se bilkul alag family
        [/keyboard|laptop|dust cover/i, 'laptop-accessories'],
        [/extension|spike\s*guard|surge/i, 'extension-boards'],
        [/sunscreen|face|skin|scrub|hand wash|cleans|facewash/i, 'skin-care'],
        // Screen guard / glass / cover / case sab ek hi 'mobile-accessories' family me (type naam se alag hota hai)
        [/screen\s*(guard|protector)|tempered|protector|(phone|mobile)\s*(cover|case)|cases?\s*&\s*covers?/i, 'mobile-accessories'],
        [/\bstands?\b|\bholders?\b|\brings?\b|popsocket|\bgrips?\b/i, 'mobile-holders'],
        [/charg|cable|power ?bank|usb hub|adapter/i, 'chargers-cables'],
        [/pen ?drive|pendrive|hard disk|usb gadget/i, 'storage-drives'],
        [/mouse/i, 'mouse'],
        [/extension|spike|surge/i, 'extension-boards'],
        [/trimmer|shaver|razor|grooming/i, 'grooming'],
        [/toothbrush|oral|toothpaste/i, 'oral-care'],
        [/hair|straighten|dryer/i, 'hair-styling'],
        [/face|sunscreen|skin|scrub|hand wash|cleans|facewash/i, 'skin-care'],
        [/chopper|peeler|grater|kitchen tool|kitchen appliance|mixer/i, 'kitchen-tools'],
        [/container|jar|storage|lunch/i, 'kitchen-storage'],
        [/bottle|flask|thermos|cups|mug|glass/i, 'bottles-flasks'],
        [/dry fruit|nuts|badam|seeds/i, 'dry-fruits'],
        [/chocolate|snack/i, 'snacks'],
        [/\btea\b|coffee|health drink|bournvita/i, 'tea-coffee'],
        [/hanger/i, 'hangers'],
        [/clean|brush|cloth|wipe|sponge|duster/i, 'cleaning']
    ];

    function toNumber(value) {
        var n = Number(value);
        return (value !== null && value !== undefined && value !== '' && isFinite(n) && n > 0) ? n : null;
    }

    function slugify(text) {
        return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    }

    function resolveCategories(rawCategory, name) {
        var label = String(rawCategory || '').trim();
        var key = label.toLowerCase();
        var mapped = CATEGORY_MAP[key] || { primary: slugify(key) || 'other', groups: [] };
        var list = [mapped.primary].concat(mapped.groups);

        GROUP_RULES.forEach(function (rule) {
            if (rule.re.test(label) && list.indexOf(rule.group) === -1) list.push(rule.group);
        });
        // "Vehicles" = toy cars / trains
        if (list.indexOf('toy') !== -1 && /\b(car|train)\b/i.test(name || '') && list.indexOf('vehicles') === -1) {
            list.push('vehicles');
        }

        var family = '';
        for (var i = 0; i < FAMILY_RULES.length; i++) {
            if (FAMILY_RULES[i][0].test(label)) { family = FAMILY_RULES[i][1]; break; }
        }
        return { primary: mapped.primary, list: list, family: family || ('f-' + mapped.primary) };
    }

    /* ---- Clothing attributes: gender / color / size (title + category label se) ---- */
    function detectGender(label, name) {
        var parts = [String(label || ''), String(name || '')];
        for (var i = 0; i < parts.length; i++) {
            var t = parts[i].toLowerCase();
            if (/\b(kids?|boys?|girls?|baby|infants?|toddlers?|children)\b/.test(t)) return 'kids';
            if (/\b(women|woman|womens|ladies|lady|female)\b/.test(t)) return 'women';
            if (/\b(men|mens|man|male|gents)\b/.test(t)) return 'men';
            if (/\bunisex\b/.test(t)) return 'unisex';
        }
        return '';
    }

    var COLOR_RE = /\b(black|white|grey|gray|red|blue|navy|green|yellow|purple|pink|orange|brown|maroon|beige|silver|gold|cream|olive|teal|multicolou?r)\b/i;
    var COLOR_ALIAS = { gray: 'grey', navy: 'blue' };

    function detectColor(name) {
        var text = String(name || '');
        var paren = text.match(/\(([^)]*)\)/g) || [];
        var m = null;
        for (var i = 0; i < paren.length && !m; i++) { m = paren[i].match(COLOR_RE); }
        if (!m) m = text.match(COLOR_RE);
        if (!m) return '';
        var c = m[1].toLowerCase();
        return COLOR_ALIAS[c] || c;
    }

    var BASE_COLORS = ['black', 'white', 'grey', 'gray', 'red', 'blue', 'navy', 'green', 'yellow', 'purple', 'pink', 'orange', 'brown', 'maroon', 'beige', 'silver', 'gold', 'cream', 'olive', 'teal'];

    // JSON ke "colour" field ("Jetblack", "Titanium Black", "Navy") ko ek standard rang me badalta hai
    function normalizeColorWord(text) {
        var t = String(text || '').toLowerCase();
        for (var i = 0; i < BASE_COLORS.length; i++) {
            if (t.indexOf(BASE_COLORS[i]) !== -1) return COLOR_ALIAS[BASE_COLORS[i]] || BASE_COLORS[i];
        }
        return '';
    }

    function detectSize(name) {
        var text = String(name || '');
        var m = text.match(/\bsize[:\s-]*(xxxl|xxl|xl|l|m|s|free\s*size)\b/i) || text.match(/\b(xxxl|xxl|xl)\b/i);
        if (!m) return '';
        var s = m[1].toLowerCase().replace(/\s+/g, '');
        return s === 'freesize' ? 'free-size' : s;
    }

    // Smartphone category me ghus aaye cover / glass wagairah ko accessories me daalne ke liye
    var PHONE_ACCESSORY_NAME = /\b(back\s*cover|flip\s*cover|phone\s*case|mobile\s*case|case\s*cover|tempered|screen\s*(guard|protector)|protector|pouch)\b/i;

    function computeDiscount(mrp, price) {
        if (mrp && price && price <= mrp) {
            return Math.round(((mrp - price) / mrp) * 100);
        }
        return null;
    }

    function normalizeProduct(raw, storeName, index) {
        var name = String(raw.name || '').replace(/\s+/g, ' ').trim();
        var mrp = toNumber(raw.mrp);
        var price = toNumber(raw.price);
        var cats = resolveCategories(raw.category, name);
        var rawLabel = raw.category;
        if (cats.family === 'mobiles' && PHONE_ACCESSORY_NAME.test(name)) {
            cats = resolveCategories('Mobile Accessories', name);
            rawLabel = 'Mobile Accessories';
        }
        // Mixed labels ke andar chhupe alag products: naam dekh kar sahi family me daalo
        if (cats.family === 'chargers-cables' && /pen\s*drive|pendrive|flash\s*drive/i.test(name) && !/\bhub\b|cable|charger/i.test(name)) {
            cats = resolveCategories('Pen Drive', name);
            rawLabel = 'Pen Drive';
        } else if (cats.family === 'toys' && /\b(cars?|trucks?|buses|bus|trains?|jeeps?|vehicles?)\b/i.test(name)) {
            cats = resolveCategories('Toy Vehicles', name);
            rawLabel = 'Toy Vehicles';
        }
        var brand = String(raw.brand || '').trim().toLowerCase() || name.split(/[\s,]+/)[0].toLowerCase();
        var gender = detectGender(rawLabel, name);
        var color = (raw.colour && normalizeColorWord(raw.colour)) || detectColor(name);
        var size = cats.family === 'clothing' ? detectSize(name) : '';

        // Outgoing link: saaf + sahi affiliate params. Agar link kharab ho to khaali
        // (UI tab store ke search-URL par fall back karta hai).
        var link = URLS.sanitize(raw.link, storeName);

        return {
            // unique id (products.json me ids repeat hote hain)
            id: storeName + '-' + (index + 1),
            sourceId: raw.id,
            title: name,
            name: name,
            store: storeName,
            brand: brand,
            gender: gender,
            color: color,
            size: size,
            category: cats.primary,
            categories: cats.list,
            family: cats.family,
            categoryLabel: rawLabel || '',
            subcategory: String(raw.subcategory || '').trim(),
            image: raw.image || '',
            price: price,
            oldPrice: mrp,
            // hamesha dobara compute: JSON me kharab values hain (431, "269OFF", null)
            discount: computeDiscount(mrp, price),
            link: link,
            dealUrl: link
        };
    }

    // Har store se baari-baari ek product (store ke andar sabse zyada discount pehle)
    // taaki 6-card Best Deals row me mix dikhe.
    function interleaveByStore(byStore) {
        var queues = STORE_ORDER.map(function (storeName) {
            return (byStore[storeName] || []).slice().sort(function (a, b) {
                var da = (a.discount === null ? -1 : a.discount);
                var db = (b.discount === null ? -1 : b.discount);
                return db - da;
            });
        });
        var result = [];
        var pointers = queues.map(function () { return 0; });
        var added = true;
        while (added) {
            added = false;
            queues.forEach(function (q, qi) {
                if (pointers[qi] < q.length) { result.push(q[pointers[qi]++]); added = true; }
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

    // 'no-cache' = browser cache use karega par har baar server se revalidate (ETag),
    // yaani 1.9 MB file har visit par dobara download nahi hoti, lekin naya deploy turant dikhta hai.
    window.CRACK_SHOPPING_PRODUCTS_READY = fetch(PRODUCTS_JSON_URL, { cache: 'no-cache' })
        .then(function (response) {
            if (!response.ok) {
                throw new Error('products.json request failed with status ' + response.status);
            }
            return response.json();
        })
        .then(function (data) {
            var dataset = buildDataset(data);
            // Same array reference sabhi Parts me share hota hai - mutate karo, replace nahi.
            window.CRACK_SHOPPING_PRODUCT_DATASET.push.apply(window.CRACK_SHOPPING_PRODUCT_DATASET, dataset);
            window.CRACK_SHOPPING_RAW_PRODUCTS = data;
            console.log('[Crack Shopping] products.json loaded:', dataset.length, 'products');
            refreshUi();   // app abhi init nahi hua to no-op; Part 4 data khud utha lega
            // Search index khali samay me pehle se bana lo, taaki pehli search turant chale.
            setTimeout(function () {
                try { window.CrackShoppingEngine && window.CrackShoppingEngine.warmUp(); } catch (e) {}
            }, 200);
            return data;
        })
        .catch(function (error) {
            console.error('[Crack Shopping] products.json load failed:', error);
            showLoadError();
            return null;
        });

})();


/* ============================================================
   CRACK SHOPPING - SEARCH + MATCH ENGINE  (DOM-free)
   ------------------------------------------------------------
   1) Smart / Fuzzy search
      - spelling mistakes (Damerau-Levenshtein distance)
      - Hinglish / phonetic spellings (kar -> car, hedfon -> headphone)
      - Hindi (Devanagari) + Hinglish intent words
      - word-start (prefix) matching, plural/singular
   2) Real cross-store matching (koi dummy price nahi)
   3) Same-category suggestions
   4) Pasted link -> dataset product lookup
   ============================================================ */

window.CrackShoppingEngine = (function () {

    var CFG = window.CRACK_SHOPPING_CONFIG;
    var URLS = window.CRACK_SHOPPING_URL;
    var DATA = window.CRACK_SHOPPING_PRODUCT_DATASET;

    /* ---------------- text helpers ---------------- */

    function norm(value) {
        return String(value === null || value === undefined ? '' : value)
            .normalize('NFC')
            .toLowerCase()
            .replace(/[\u2018\u2019'`]/g, '')
            .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    // simple plural / singular normaliser (cables->cable, watches->watch, batteries->battery)
    function stem(word) {
        if (!/^[a-z0-9]+$/.test(word)) return word;
        if (word.length > 4 && /ies$/.test(word)) return word.slice(0, -3) + 'y';
        if (word.length > 4 && /(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
        if (word.length > 3 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
        return word;
    }

    function tokenize(text) {
        var out = [];
        norm(text).split(' ').forEach(function (w) {
            if (w.length > 1) out.push(stem(w));
        });
        return out;
    }

    // Damerau-Levenshtein (adjacent swap = 1 edit) with early exit.
    function editDistance(a, b, max) {
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > max) return max + 1;
        var prev2 = null;
        var prev = new Array(lb + 1);
        var cur = new Array(lb + 1);
        var i, j;
        for (j = 0; j <= lb; j++) prev[j] = j;
        for (i = 1; i <= la; i++) {
            cur[0] = i;
            var rowMin = cur[0];
            for (j = 1; j <= lb; j++) {
                var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
                var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
                if (prev2 && i > 1 && j > 1 &&
                    a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
                    a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) {
                    v = Math.min(v, prev2[j - 2] + 1);
                }
                cur[j] = v;
                if (v < rowMin) rowMin = v;
            }
            if (rowMin > max) return max + 1;
            prev2 = prev;
            prev = cur;
            cur = new Array(lb + 1);
        }
        return prev[lb];
    }

    // Hinglish / phonetic "skeleton": car/kar/kaar -> "kr", headphone/hedfon -> "h|dfn"
    function skeletonKey(word) {
        if (!/^[a-z]+$/.test(word)) return '';
        var s = word
            .replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/q/g, 'k').replace(/x/g, 'ks')
            .replace(/w/g, 'v').replace(/z/g, 'j')
            .replace(/ch/g, 'C').replace(/sh/g, 'S')
            .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k');
        var consonants = s.replace(/[aeiouyh]/g, '').replace(/(.)\1+/g, '$1');
        if (consonants.length < 3) return '';
        return s.charAt(0) + '|' + consonants;
    }

    function maxEdits(len) {
        if (len <= 3) return 0;
        if (len <= 6) return 1;
        return 2;
    }

    /* ---------------- Hindi + Hinglish intent words ----------------
       t = user ke shabd (English / Hinglish / Hindi)
       x = product titles me dhundhne wale English shabd
       c = (optional) category-button groups
       Naya shabd sikhana ho to bas yahan ek entry jod dein.
       ------------------------------------------------------------ */
    var INTENTS = [
        { t: ['car', 'cars', 'kar', 'kaar', 'gaadi', 'gadi', 'gadiya', 'gaadiyan', 'कार', 'गाड़ी', 'गाड़ियां', 'गाडी', 'गाड़ियाँ'], x: ['car', 'vehicle'], c: ['vehicles'] },
        { t: ['toy', 'toys', 'khilona', 'khilone', 'khilauna', 'khilaune', 'khelna', 'खिलौना', 'खिलौने', 'टॉय'], x: ['toy', 'toys'], c: ['toy'] },
        { t: ['kitchen', 'rasoi', 'kichan', 'किचन', 'रसोई'], x: ['kitchen'], c: ['kitchen-set'] },
        { t: ['headphone', 'headphones', 'earphone', 'earphones', 'earbud', 'earbuds', 'hedfon', 'headfon', 'hedphone', 'iyarphone', 'इयरफोन', 'ईयरफोन', 'हेडफोन', 'ईयरबड्स', 'इयरबड्स'], x: ['headphone', 'earphone', 'earbud'], c: ['headphones'] },
        { t: ['electric', 'electronics', 'electronic', 'इलेक्ट्रॉनिक', 'इलेक्ट्रिक'], x: ['electric', 'electronic'], c: ['electric'] },
        { t: ['watch', 'watches', 'smartwatch', 'ghadi', 'ghari', 'vaach', 'घड़ी', 'घडी', 'वॉच'], x: ['watch', 'smartwatch'], c: ['smartwatches'] },
        { t: ['clothes', 'clothing', 'cloth', 'kapde', 'kapda', 'kapde', 'कपड़े', 'कपड़ा', 'कपडे'], x: ['clothes', 'clothing', 'cloth'], c: ['clothing'] },
        { t: ['shoes', 'shoe', 'footwear', 'joota', 'joote', 'jute', 'juta', 'जूते', 'जूता'], x: ['shoe', 'footwear'], c: [] },
        { t: ['mobile', 'mobiles', 'phone', 'phones', 'smartphone', 'fon', 'foon', 'mobail', 'mobil', 'मोबाइल', 'फोन', 'फ़ोन'], x: ['mobile', 'phone', 'smartphone'], c: ['mobiles'] },
        { t: ['charger', 'chargers', 'charging', 'chargar', 'cable', 'cables', 'kebal', 'चार्जर', 'केबल'], x: ['charger', 'cable'], c: [] },
        { t: ['bottle', 'bottles', 'botal', 'bottal', 'botl', 'flask', 'बोतल'], x: ['bottle', 'flask'], c: [] },
        { t: ['bag', 'bags', 'backpack', 'baig', 'bega', 'बैग'], x: ['bag', 'backpack'], c: [] },
        { t: ['trimmer', 'trimar', 'ट्रिमर'], x: ['trimmer'], c: [] },
        { t: ['chopper', 'choper', 'sabji', 'sabzi', 'सब्जी', 'सब्ज़ी', 'चॉपर'], x: ['chopper', 'vegetable'], c: [] },
        { t: ['mouse', 'maus', 'माउस'], x: ['mouse'], c: [] },
        { t: ['powerbank', 'पावरबैंक'], x: ['power', 'bank'], c: [] },
        { t: ['pendrive', 'pendriv', 'पेनड्राइव'], x: ['pen', 'drive', 'pendrive'], c: [] },
        { t: ['dryfruit', 'dryfruits', 'badam', 'kaju', 'meva', 'मेवा', 'बादाम', 'काजू'], x: ['dry', 'fruit', 'almond', 'cashew'], c: [] },
        { t: ['chocolate', 'chocolates', 'chocolet', 'chocklet', 'chakleti', 'चॉकलेट'], x: ['chocolate'], c: [] },
        { t: ['sunscreen', 'facewash', 'cream', 'क्रीम', 'फेसवाश'], x: ['sunscreen', 'face', 'wash', 'cream'], c: [] }
    ];

    // alias -> intent  (Latin aliases ko stem karke, Hindi ko NFC karke)
    var INTENT_MAP = new Map();
    var INTENT_LATIN_KEYS = [];
    INTENTS.forEach(function (intent) {
        intent.t.forEach(function (term) {
            var key = norm(term);
            var keyStem = stem(key);
            if (!INTENT_MAP.has(keyStem)) INTENT_MAP.set(keyStem, intent);
            if (!INTENT_MAP.has(key)) INTENT_MAP.set(key, intent);
            if (/^[a-z]+$/.test(keyStem) && keyStem.length >= 5) INTENT_LATIN_KEYS.push([keyStem, intent]);
        });
    });

    var STOP_QUERY = new Set(['for', 'with', 'and', 'the', 'of', 'in', 'to', 'a', 'an', 'by', 'me', 'my',
        'ke', 'ki', 'ka', 'ko', 'se', 'hai', 'wala', 'wali', 'wale', 'best', 'buy', 'online', 'price',
        'cheap', 'sasta', 'sabse', 'chahiye', 'dikhao']);

    /* ---------------- search index ---------------- */

    var index = { count: -1, inv: new Map(), vocab: new Map(), skel: new Map(), catIdx: new Map() };
    var queryCache = new Map();

    function pushTo(map, key, value) {
        var list = map.get(key);
        if (!list) { list = []; map.set(key, list); }
        list.push(value);
    }

    function buildIndex() {
        if (index.count === DATA.length) return index;

        index = { count: DATA.length, inv: new Map(), vocab: new Map(), skel: new Map(), catIdx: new Map() };
        queryCache = new Map();

        DATA.forEach(function (product, i) {
            var titleSet = new Set();
            var catSet = new Set();

            tokenize(product.title).slice(0, 40).forEach(function (w) { titleSet.add(w); });
            tokenize(product.categoryLabel).forEach(function (w) { titleSet.add(w); catSet.add(w); });

            product._ix = { t: titleSet, c: catSet, n: norm(product.title), cn: tokenize(product.categoryLabel).join(' ') };

            titleSet.forEach(function (w) {
                pushTo(index.inv, w, i);
                index.vocab.set(w, (index.vocab.get(w) || 0) + 1);
            });
            (product.categories || []).forEach(function (slug) { pushTo(index.catIdx, slug, i); });
        });

        index.vocab.forEach(function (df, word) {
            var key = skeletonKey(word);
            if (key) pushTo(index.skel, key, word);
        });
        return index;
    }

    function findIntent(rawToken, stemmed) {
        var hit = INTENT_MAP.get(rawToken) || INTENT_MAP.get(stemmed);
        if (hit) return { intent: hit, exact: true };
        if (/^[a-z]+$/.test(stemmed) && stemmed.length >= 5) {
            var max = maxEdits(stemmed.length);
            for (var i = 0; i < INTENT_LATIN_KEYS.length; i++) {
                var key = INTENT_LATIN_KEYS[i][0];
                if (Math.abs(key.length - stemmed.length) <= max && editDistance(stemmed, key, max) <= max) {
                    return { intent: INTENT_LATIN_KEYS[i][1], exact: false };
                }
            }
        }
        return null;
    }

    // Ek query-shabd ke saare "milte-julte" vocabulary shabd + weight.
    function buildAlternatives(rawToken) {
        var q = stem(rawToken);
        var words = new Map();
        var cats = [];
        var display = '';
        var displayWeight = 0;

        function put(word, weight, canDisplay) {
            if (weight > (words.get(word) || 0)) words.set(word, weight);
            if (canDisplay && weight < 1 && weight > displayWeight) { displayWeight = weight; display = word; }
        }

        var df = index.vocab.get(q) || 0;
        if (df) words.set(q, 1);

        // Barabari par zyada common shabd jeete (wach -> watch, wash nahi)
        function freqBonus(word) {
            return Math.min(0.09, Math.log10((index.vocab.get(word) || 0) + 1) / 40);
        }

        var isLatin = /^[a-z]+$/.test(q);
        var hasLetter = /\D/.test(q);

        // word-start match: "head" -> headphone, "samsu" -> samsung
        if (q.length >= 3 && hasLetter) {
            index.vocab.forEach(function (c, word) {
                if (word.length > q.length && word.indexOf(q) === 0) put(word, 0.8, false);
            });
        }

        // spelling mistakes + Hinglish phonetics (sirf tab jab shabd khud common nahi hai)
        if (isLatin && df < 5) {
            var allowed = maxEdits(q.length);
            if (allowed) {
                index.vocab.forEach(function (c, word) {
                    if (word === q || Math.abs(word.length - q.length) > allowed || !/^[a-z]+$/.test(word)) return;
                    var d = editDistance(q, word, allowed);
                    if (d <= allowed) put(word, (d === 1 ? 0.8 : 0.62) + freqBonus(word), true);
                });
            }
            var sk = skeletonKey(q);
            if (sk) {
                var same = index.skel.get(sk);
                if (same) same.forEach(function (word) { if (word !== q) put(word, 0.68 + freqBonus(word), true); });
            }
        }

        // Hindi / Hinglish intent words ("kar", "gaadi", "कार", "खिलौना", ...)
        var found = findIntent(norm(rawToken), q);
        if (found) {
            found.intent.x.forEach(function (term) {
                var st = stem(norm(term));
                if (index.vocab.has(st)) put(st, found.exact ? 0.85 : 0.7, true);
            });
            cats = found.intent.c || [];
        }

        // Shabd khud product titles me milta hai to "correction" dikhane ki zarurat nahi.
        if (df > 0) display = '';

        return { words: words, cats: cats, display: display };
    }

    function categoryTokenHit(product, alts) {
        var catTokens = product._ix.c;
        var hit = false;
        catTokens.forEach(function (w) {
            if (hit) return;
            for (var i = 0; i < alts.length; i++) {
                if ((alts[i].words.get(w) || 0) >= 0.7) { hit = true; return; }
            }
        });
        return hit;
    }

    function search(query) {
        buildIndex();
        var key = norm(query);
        var empty = { results: [], corrected: '', query: key };
        if (!key) return empty;

        var cacheKey = key + '|' + index.count;
        if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

        var tokens = key.split(' ').filter(Boolean);
        var meaningful = tokens.filter(function (t) { return !STOP_QUERY.has(t); });
        if (meaningful.length) tokens = meaningful;
        tokens = tokens.slice(0, 8);

        var n = tokens.length;
        var alts = tokens.map(buildAlternatives);

        // Jude hue shabd: "smart watch" / "smart wach" -> title ka "smartwatch"
        for (var ti = 0; ti + 1 < n; ti++) {
            var joined = stem(tokens[ti] + tokens[ti + 1]);
            var joinedHit = '';
            if (index.vocab.has(joined)) {
                joinedHit = joined;
            } else if (/^[a-z]+$/.test(joined) && joined.length >= 7) {
                var bestDf = 0;
                index.vocab.forEach(function (c, word) {
                    if (Math.abs(word.length - joined.length) > 1 || !/^[a-z]+$/.test(word)) return;
                    if (c > bestDf && editDistance(joined, word, 1) <= 1) { bestDf = c; joinedHit = word; }
                });
            }
            if (joinedHit) {
                alts[ti].words.set(joinedHit, Math.max(alts[ti].words.get(joinedHit) || 0, 0.9));
                alts[ti + 1].words.set(joinedHit, Math.max(alts[ti + 1].words.get(joinedHit) || 0, 0.9));
                if (joinedHit !== joined) {
                    alts[ti].display = joinedHit;
                    alts[ti + 1].display = '\u0000';   // is shabd ko correction-text me chhod do
                }
            }
        }

        var effectiveKey = tokens.map(function (t, i) { return alts[i].display || stem(t); }).join(' ');
        var scores = new Map();

        alts.forEach(function (alt, qi) {
            alt.words.forEach(function (weight, word) {
                var list = index.inv.get(word);
                if (!list) return;
                for (var k = 0; k < list.length; k++) {
                    var id = list[k];
                    var arr = scores.get(id);
                    if (!arr) { arr = new Float32Array(n); scores.set(id, arr); }
                    if (weight > arr[qi]) arr[qi] = weight;
                }
            });
            alt.cats.forEach(function (slug) {
                var list = index.catIdx.get(slug);
                if (!list) return;
                for (var k = 0; k < list.length; k++) {
                    var id = list[k];
                    var arr = scores.get(id);
                    if (!arr) { arr = new Float32Array(n); scores.set(id, arr); }
                    if (0.45 > arr[qi]) arr[qi] = 0.45;
                }
            });
        });

        var full = [];
        var partial = [];
        scores.forEach(function (arr, id) {
            var product = DATA[id];
            var sum = 0, matched = 0;
            for (var i = 0; i < n; i++) {
                if (arr[i] > 0) { matched++; sum += arr[i]; }
            }
            var score = sum / n;
            if (matched === n) {
                if (n > 1 && product._ix.n.indexOf(key) !== -1) score += 0.25;   // poora phrase title me
                if (categoryTokenHit(product, alts)) score += 0.1;                // category ke naam se match
                if (product._ix.cn === effectiveKey) score += 0.15;                // poori category ka naam hi query hai
                full.push({ p: product, s: score });
            } else {
                partial.push({ p: product, s: score * 0.6 });
            }
        });

        // Google jaisa: jahan saare shabd milte hon unhe hi dikhao; warna sabse kareebi.
        var chosen = full.length ? full : partial;
        chosen.sort(function (a, b) {
            if (b.s !== a.s) return b.s - a.s;
            return (b.p.popularity || 0) - (a.p.popularity || 0);
        });

        var corrected = '';
        if (alts.some(function (a) { return a.display; })) {
            corrected = tokens.map(function (t, i) { return alts[i].display || t; }).filter(function (w) { return w !== '\u0000'; }).join(' ');
        }

        var result = {
            results: chosen.map(function (entry) { return entry.p; }),
            corrected: corrected,
            query: key
        };
        if (queryCache.size > 30) queryCache.clear();
        queryCache.set(cacheKey, result);
        return result;
    }

    /* ---------------- cross-store matching ---------------- */

    var STOP_MATCH = new Set(['with', 'and', 'for', 'the', 'of', 'in', 'to', 'by', 'pack', 'set', 'combo', 'new',
        'latest', 'edition', 'upto', 'up', 'free', 'size', 'color', 'colour', 'black', 'white', 'blue', 'red',
        'green', 'grey', 'gray', 'pink', 'yellow', 'purple', 'orange', 'brown', 'silver', 'gold', 'multicolor',
        'men', 'women', 'mens', 'womens', 'kids', 'kid']);

    var matchIndex = null;

    function matchTokens(product) {
        if (product._mt) return product._mt;
        var words = norm(String(product.title || '').replace(/\(.*?\)/g, ' ')).split(' ');
        var out = [];
        words.forEach(function (w) {
            if (w.length > 1 && !STOP_MATCH.has(w)) out.push(stem(w));
        });
        product._mt = out.slice(0, 14);
        product._ms = new Set(product._mt);
        return product._mt;
    }

    function buildMatchIndex() {
        if (matchIndex && matchIndex.count === DATA.length) return matchIndex;
        matchIndex = { count: DATA.length, inv: new Map(), df: new Map() };
        DATA.forEach(function (product, i) {
            matchTokens(product);
            product._ms.forEach(function (w) {
                pushTo(matchIndex.inv, w, i);
                matchIndex.df.set(w, (matchIndex.df.get(w) || 0) + 1);
            });
            product._matches = null;
        });
        return matchIndex;
    }

    function idf(word) {
        return Math.log(1 + DATA.length / ((matchIndex.df.get(word)) || 1));
    }

    // IDF-weighted Dice similarity (0..1)
    function similarity(a, b) {
        buildMatchIndex();
        matchTokens(a); matchTokens(b);
        var inter = 0, wa = 0, wb = 0;
        a._ms.forEach(function (w) { var x = idf(w); wa += x; if (b._ms.has(w)) inter += x; });
        b._ms.forEach(function (w) { wb += idf(w); });
        return (wa + wb) ? (2 * inter) / (wa + wb) : 0;
    }

    function digitTokens(product) {
        return product._mt.filter(function (w) { return /\d/.test(w); });
    }

    // ---- Rule 1: Strict Category + Subcategory ----
    // Alag-alag stores ke subcategory-naam ek hi key me (Kurtis = Kurtas, Smartphones = Mobiles ...)
    var SUBCAT_ALIAS = {
        'tshirts': 'tshirt', 'tshirt': 'tshirt', 'tees': 'tshirt',
        'kurtis': 'kurta', 'kurtas': 'kurta', 'kurti': 'kurta', 'kurta': 'kurta',
        'kurta sets': 'kurta-set', 'kurta set': 'kurta-set',
        'smartphones': 'mobiles', 'mobiles': 'mobiles',
        'tights leggings': 'leggings', 'jeggings': 'leggings',
        'sarees': 'saree', 'saree': 'saree', 'shirts': 'shirt', 'shirt': 'shirt',
        'jeans': 'jeans', 'trousers': 'trousers', 'track pants': 'track-pants',
        'dresses': 'dress', 'dress': 'dress', 'tops': 'top', 'top': 'top'
    };

    // Amazon ke data me subcategory field nahi hai -> clothing ka subcategory naam se nikalte hain.
    var SUBCAT_FROM_NAME = [
        [/kurta\s*set|kurti\s*set|kurta\s+with\s+(palazzo|pant|dupatta)/i, 'kurta-set'],
        [/\bkurta\b|\bkurti\b|\bkurtis\b|\bkurtas\b/i, 'kurta'],
        [/saree|sari\b/i, 'saree'],
        [/t-?\s?shirt|\btee\b|\bpolo\b/i, 'tshirt'],
        [/track\s*pant|trackpant|jogger/i, 'track-pants'],
        [/\bjeans?\b|denim/i, 'jeans'],
        [/jegging|legging|tights/i, 'leggings'],
        [/trouser|chino|cargo\s*pant|formal\s*pant/i, 'trousers'],
        [/\bshirt\b|\bshirts\b/i, 'shirt'],
        [/\bdress\b|\bgown\b|\bmaxi\b/i, 'dress'],
        [/\btop\b|\btops\b|\bcrop\b/i, 'top']
    ];

    function subKey(product) {
        if (product._sub !== undefined) return product._sub;
        var raw = norm(product.subcategory || '');
        var key = '';
        if (raw) {
            key = SUBCAT_ALIAS[raw] || stem(raw);
        } else if (/clothing/i.test(product.categoryLabel || '')) {
            for (var i = 0; i < SUBCAT_FROM_NAME.length; i++) {
                if (SUBCAT_FROM_NAME[i][0].test(product.title || '')) { key = SUBCAT_FROM_NAME[i][1]; break; }
            }
            if (!key) key = '?';          // clothing ka subcategory pata nahi -> match nahi karenge
        }
        // Phone ka subcategory hamesha 'mobiles' (Amazon me field hi nahi hota);
        // accessories ka type naam se (cover / screen-guard / charger ...), unknown => match nahi.
        if (product.family === 'mobiles') key = 'mobiles';
        else if (product.family === 'mobile-accessories') key = accessoryType(product) || '?';
        product._sub = key;
        return key;
    }

    /* ============ MASTER RULES helpers ============ */

    // ---- Mobile Accessories: type + phone-model compatibility ----
    var ACCESSORY_TYPES = [
        [/earphone|earbud|headphone|neckband|headset/i, 'audio'],
        [/tempered|screen\s*(guard|protector)|glass\s*guard|protector|privacy\s*glass|\bglass\b/i, 'screen-guard'],
        [/back\s*cover|flip\s*cover|\bcover\b|\bcase\b|pouch|bumper/i, 'cover'],
        [/power\s*bank/i, 'powerbank'],
        [/charger|adapter|adaptor/i, 'charger'],
        [/cable|\bcord\b/i, 'cable'],
        [/\bring\b|popsocket|\bstand\b|\bholder\b|\bgrip\b/i, 'holder'],
        [/pen\s*drive|pendrive|memory\s*card|\botg\b/i, 'storage']
    ];

    function accessoryType(product) {
        var t = String(product.title || '');
        for (var i = 0; i < ACCESSORY_TYPES.length; i++) {
            if (ACCESSORY_TYPES[i][0].test(t)) return ACCESSORY_TYPES[i][1];
        }
        return '';
    }

    var DEVICE_BRAND_MAP = {
        iphone: 'apple', apple: 'apple', samsung: 'samsung', galaxy: 'samsung', redmi: 'xiaomi', xiaomi: 'xiaomi',
        mi: 'xiaomi', poco: 'poco', realme: 'realme', oppo: 'oppo', vivo: 'vivo', iqoo: 'iqoo', oneplus: 'oneplus',
        nothing: 'nothing', motorola: 'motorola', moto: 'motorola', infinix: 'infinix', tecno: 'tecno', itel: 'itel',
        lava: 'lava', pixel: 'google', google: 'google', honor: 'honor', nokia: 'nokia'
    };

    function deviceKey(product) {
        var seen = {}, list = [];
        norm(product.title).split(' ').forEach(function (w) {
            var b = DEVICE_BRAND_MAP.hasOwnProperty(w) ? DEVICE_BRAND_MAP[w] : '';
            if (b && !seen[b]) { seen[b] = true; list.push(b); }
        });
        return list.sort().join(',');
    }

    // cover / glass sirf apne hi phone-model ke saath (aur sirf apne type ke saath)
    function accessoryOk(a, b) {
        var type = subKey(a);
        if (type !== subKey(b)) return false;
        if (type === 'cover' || type === 'screen-guard') {
            return deviceKey(a) === deviceKey(b);
        }
        return true;
    }

    // ---- Mobiles: RAM + Storage sakht ----
    function memorySpec(product) {
        if (product._mem) return product._mem;
        var t = String(product.title || ''), vals = [], re = /(\d+(?:\.\d+)?)\s*(gb|tb)\b/gi, m;
        while ((m = re.exec(t))) vals.push(parseFloat(m[1]) * (m[2].toLowerCase() === 'tb' ? 1024 : 1));
        var ramM = t.match(/(\d+)\s*gb\s*ram/i) || t.match(/ram\s*[:\-]?\s*(\d+)\s*gb/i);
        var ram = ramM ? parseInt(ramM[1], 10) : 0;
        var storage = vals.length ? Math.max.apply(null, vals) : 0;
        if (!ram && vals.length > 1) ram = Math.min.apply(null, vals);
        if (ramM && vals.length <= 1) storage = 0;
        product._mem = { ram: ram, storage: storage };
        return product._mem;
    }

    function sameMobileMemory(a, b) {
        var x = memorySpec(a), y = memorySpec(b);
        if (!x.storage || !y.storage || x.storage !== y.storage) return false;   // storage dono me hona + barabar hona zaruri
        if (x.ram && y.ram && x.ram !== y.ram) return false;                    // RAM dono me ho to barabar
        return true;
    }

    // ---- ml / litre / gram / kg / pack-of ----
    var QUANTITY_FAMILIES = {
        'bottles-flasks': 1, 'kitchen-storage': 1, 'dry-fruits': 1, 'snacks': 1,
        'tea-coffee': 1, 'skin-care': 1, 'oral-care': 1
    };

    function quantitySpec(product) {
        if (product._qty) return product._qty;
        var t = String(product.title || ''), vol = 0, wt = 0, pack = 1, m;
        if (product.family !== 'clothing') {
            var re = /(\d+(?:\.\d+)?)\s*(ml|ltrs?|litres?|liters?|l|kgs?|gms?|grams?|g)\b/gi;
            while ((m = re.exec(t))) {
                var n = parseFloat(m[1]), u = m[2].toLowerCase();
                if (u === 'ml') vol = Math.max(vol, n);
                else if (/^(l|ltr|ltrs|litre|litres|liter|liters)$/.test(u)) vol = Math.max(vol, n * 1000);
                else if (/^kgs?$/.test(u)) wt = Math.max(wt, n * 1000);
                else if (n > 5) wt = Math.max(wt, n);          // "5G" network ko gram na samjho
            }
        }
        m = t.match(/(?:pack|set|combo)\s*of\s*(\d+)/i) || t.match(/\b(\d+)\s*(?:pcs|pc|pieces|piece|packs?|units)\b/i);
        if (m) pack = parseInt(m[1], 10) || 1;
        product._qty = { vol: vol, wt: wt, pack: pack };
        return product._qty;
    }

    function sameAmount(p, q, strict) {
        if (!p && !q) return true;
        if (!p || !q) return !strict;                       // packed saaman me ek taraf size na ho to match nahi
        return Math.abs(p - q) / Math.max(p, q) <= 0.005;
    }

    function quantityOk(a, b) {
        var x = quantitySpec(a), y = quantitySpec(b);
        var strict = !!QUANTITY_FAMILIES[a.family];
        if (!sameAmount(x.vol, y.vol, strict)) return false;
        if (!sameAmount(x.wt, y.wt, strict)) return false;
        return x.pack === y.pack;
    }

    // ---- Clothing: gender / color / size / brand ----
    function brandWord(product) {
        var skip = { men: 1, mens: 1, women: 1, womens: 1, kids: 1, kid: 1, boys: 1, boy: 1, girls: 1, girl: 1,
                     pack: 1, set: 1, new: 1, the: 1, for: 1 };
        var words = norm(product.title).split(' ');
        for (var i = 0; i < words.length && i < 3; i++) {
            if (words[i].length > 1 && !skip[words[i]] && !/^\d/.test(words[i])) return words[i];
        }
        return '';
    }

    function titleHasWord(product, word) {
        return !!word && (' ' + norm(product.title) + ' ').indexOf(' ' + word + ' ') !== -1;
    }

    function clothingOk(a, b) {
        if (a.color && b.color && a.color !== b.color) return false;
        if (a.size && b.size && a.size !== b.size) return false;
        var ba = brandWord(a), bb = brandWord(b);
        if (ba && bb && ba !== bb && !titleHasWord(b, ba) && !titleHasWord(a, bb)) return false;
        return true;
    }

    // Men / Women / Kids kabhi mix nahi. Clothing me gender dono taraf pata hona zaruri;
    // baaki categories me sirf tab rokte hain jab dono ka gender pata ho aur alag ho.
    // lenient = true (sirf suggestions) => gender pata na ho to rok-tok nahi.
    function genderCompatible(a, b, lenient) {
        var ga = a.gender || '', gb = b.gender || '';
        if (a.family === 'clothing' || b.family === 'clothing') {
            if (lenient && (!ga || !gb)) return true;
            return !!ga && ga === gb;
        }
        if (ga && gb && ga !== 'unisex' && gb !== 'unisex') return ga === gb;
        return true;
    }

    function sameSpecs(a, b) {
        if (a.family === 'mobiles' && !sameMobileMemory(a, b)) return false;
        if (!quantityOk(a, b)) return false;
        if (a.family === 'clothing' && !clothingOk(a, b)) return false;
        if (a.family === 'mobile-accessories' && !accessoryOk(a, b)) return false;
        return true;
    }

    // Debug: console me `CrackShoppingEngine.auditCategories()` chalayein -
    // har (store | category | subcategory) kis family me gaya, aur kaunsa label unmapped ('f-...') raha.
    function auditCategories() {
        var table = {};
        DATA.forEach(function (p) {
            var key = p.store + ' | ' + p.categoryLabel + ' | ' + p.subcategory;
            if (!table[key]) table[key] = { store: p.store, category: p.categoryLabel, subcategory: p.subcategory, family: p.family, count: 0 };
            table[key].count++;
        });
        var rows = Object.keys(table).map(function (k) { return table[k]; })
            .sort(function (a, b) { return a.family < b.family ? -1 : a.family > b.family ? 1 : b.count - a.count; });
        if (console.table) console.table(rows);
        return rows;
    }

    // Ek family ke andar sub-type (chopper != peeler, dryer != straightener, car-cleaning != cloth ...).
    // Last rule /[\s\S]/ = default type: tab "unknown" bhi alag type maana jaata hai.
    var ANY = /[\s\S]/;
    var TYPE_RULES = {
        'kitchen-tools':      [[/peeler|grater/i, 'peeler-grater'], [/mixer|grinder|blender/i, 'mixer'], [/chopper|cutter|slicer/i, 'chopper'], [ANY, 'other']],
        'hair-styling':       [[/straighten|flat\s*iron|crimper|curler/i, 'straightener'], [/dryer|drier/i, 'dryer'], [/\bbrush|\bcomb\b/i, 'brush'], [ANY, 'other']],
        'grooming':           [[/razor/i, 'razor'], [/shaver/i, 'shaver'], [/trimmer/i, 'trimmer'], [ANY, 'other']],
        'laptop-accessories': [[/\bbag\b|backpack|sleeve/i, 'bag'], [/cooling\s*pad|cooler/i, 'cooling-pad'], [/keyboard\s*(skin|cover|protector|guard)|dust\s*cover/i, 'keyboard-skin'], [/stand|table|desk/i, 'stand'], [/clean/i, 'cleaner'], [ANY, 'other']],
        'chargers-cables':    [[/power\s*bank/i, 'powerbank'], [/\bhubs?\b/i, 'hub'], [/charger|adapter|adaptor/i, 'charger'], [/cable|\bcord\b/i, 'cable'], [ANY, 'other']],
        'oral-care':          [[/toothpaste/i, 'toothpaste'], [/electric|sonic|rechargeable/i, 'electric-brush'], [/brush/i, 'toothbrush'], [ANY, 'other']],
        'bottles-flasks':     [[/\b(mugs?|cups?|tumblers?)\b/i, 'cup'], [ANY, 'bottle']],
        'skin-care':          [[/hand\s*wash/i, 'handwash'], [/face\s*wash|facewash|cleanser/i, 'facewash'], [/sunscreen|spf/i, 'sunscreen'], [/scrub|sponge/i, 'scrub'], [ANY, 'other']],
        'cleaning':           [[/\bcar\b|vehicle|\bbike\b/i, 'car'], [ANY, 'general']],
        'audio':              [[/wired|3\.5\s*mm|\baux\b/i, 'wired'], [ANY, 'wireless']],
        'f-anime-merchandise': [[/t-?\s?shirt|\btee\b/i, 'tshirt'], [/figure|figurine|statue|showpiece|funko|bobble/i, 'figure'], [/backpack|\bbag\b/i, 'bag'], [/notebook|diary|journal/i, 'notebook'], [/key\s?chain|keyring/i, 'keychain'], [/poster|sticker/i, 'poster'], [ANY, 'other']]
    };

    function typeKey(product) {
        if (product._type !== undefined) return product._type;
        var rules = TYPE_RULES[product.family], key = '';
        if (rules) {
            var t = String(product.title || '');
            for (var i = 0; i < rules.length; i++) {
                if (rules[i][0].test(t)) { key = rules[i][1]; break; }
            }
        }
        product._type = key;
        return key;
    }

    function sameCategory(a, b) {
        if (!sameCategoryBase(a, b)) return false;
        return genderCompatible(a, b, false);
    }

    function sameCategoryBase(a, b) {
        if (!a.family || a.family !== b.family) return false;                 // category family bilkul same
        if (a.family.indexOf('f-') === 0 && a.category !== b.category) return false;
        var sa = subKey(a), sb = subKey(b);
        if (sa === '?' || sb === '?') return false;
        if (sa && sb && sa !== sb) return false;   // jis store me subcategory field nahi (Amazon), wahan family + type se jaanchte hain
        return typeKey(a) === typeKey(b);                                                      // subcategory bilkul same
    }

    // ---- Rule 2: 80% Name Fuzzy Matching ----
    // Naam ke "core" shabd (| , ( se pehle ka hissa, colour/size/marketing hata kar) tulna karte hain.
    var NAME_NOISE = new Set(['with', 'and', 'for', 'the', 'of', 'in', 'to', 'by', 'pack', 'set', 'combo', 'new',
        'latest', 'edition', 'free', 'size', 'color', 'colour', 'gb', 'ram', 'storage', 'rom']);

    function coreWords(product) {
        if (product._cw) return product._cw;
        var title = String(product.title || '').split(/[|\u2022]/)[0].replace(/\(.*?\)/g, ' ');
        var words = [];
        norm(title).split(' ').forEach(function (w) {
            if (w.length > 1 && !NAME_NOISE.has(w) && !STOP_MATCH.has(w)) words.push(stem(w));
        });
        product._cw = words.slice(0, 10);
        return product._cw;
    }

    // do shabd "same" maane jaate hain agar barabar hon ya 1 spelling-edit (lamba shabd) ka fark ho
    function sameWord(x, y) {
        if (x === y) return true;
        if (x.length < 5 || y.length < 5 || /\d/.test(x + y)) return false;
        return editDistance(x, y, 1) <= 1;
    }

    function nameMatchRatio(a, b) {
        var wa = coreWords(a), wb = coreWords(b);
        if (!wa.length || !wb.length) return 0;
        var small = wa.length <= wb.length ? wa : wb;
        var large = wa.length <= wb.length ? wb : wa;
        var used = {}, hit = 0;
        small.forEach(function (w) {
            for (var i = 0; i < large.length; i++) {
                if (!used[i] && sameWord(w, large[i])) { used[i] = true; hit++; break; }
            }
        });
        // bade naam ke hisaab se: extra shabd wale (galat) product ka score girta hai
        return hit / Math.max(wa.length, wb.length);
    }

    // Variant-shabd (Pro / Plus / FE / Ultra ...) dono naam me same hone chahiye:
    // "Note 17" aur "Note 17 Pro" alag product hain, bhale 80% shabd milte hon.
    var VARIANT_WORDS = new Set(['pro', 'plus', 'max', 'ultra', 'fe', 'se', 'lite', 'neo', 'mini', 'prime', 'edge',
        'turbo', 'gt', 'air', 'power', 'fold', 'flip', 'youth', 'slim', 'active', 'speed']);
    function sameVariant(a, b) {
        var va = coreWords(a).filter(function (w) { return VARIANT_WORDS.has(w); }).sort().join(',');
        var vb = coreWords(b).filter(function (w) { return VARIANT_WORDS.has(w); }).sort().join(',');
        return va === vb;
    }

    // Storage (128 GB / 256 GB / 1 TB): title me jo sabse bada GB/TB hai wahi storage hai (RAM chhota hota hai).
    function storageGb(product) {
        if (product._gb !== undefined) return product._gb;
        var best = 0, re = /(\d+(?:\.\d+)?)\s*(gb|tb)\b/gi, m;
        var t = String(product.title || '');
        while ((m = re.exec(t))) {
            var v = parseFloat(m[1]) * (m[2].toLowerCase() === 'tb' ? 1024 : 1);
            if (v > best) best = v;
        }
        product._gb = best;
        return best;
    }
    function sameStorage(a, b) {
        var x = storageGb(a), y = storageGb(b);
        return !x || !y || x === y;
    }

    // ---- Rule 3: Price Variance Limit (20%) ----
    function priceWithinLimit(a, b, maxDiff) {
        if (!a.price || !b.price) return false;
        var hi = Math.max(a.price, b.price), lo = Math.min(a.price, b.price);
        return (hi - lo) / hi <= maxDiff;      // sasta product mahenge ka kam se kam 80%
    }

    // Model number (s23, 15, 5000 ...) bilkul same hona chahiye; 5g / gb / mah jaise spec-shabd ignore.
    var SPEC_TOKEN = /^(\d+g|\d+gb|\d+tb|\d+mah|\d+w|\d+hz|\d+mp|\d+h|\d+mm|\d+cm|\d+ml|\d+l)$/;
    function sameModelNumbers(a, b) {
        var x = a.filter(function (w) { return !SPEC_TOKEN.test(w); });
        var y = b.filter(function (w) { return !SPEC_TOKEN.test(w); });
        if (!x.length || !y.length) return true;
        var small = x.length <= y.length ? x : y, large = x.length <= y.length ? y : x;
        return small.every(function (w) { return large.indexOf(w) !== -1; });
    }

    // Dusre stores me ASLI (dataset me maujood) same product dhundhta hai.
    // 3 sakht niyam: (1) category+subcategory same (2) naam 80% match (3) keemat me max 20% fark.
    // Extra suraksha: model number / capacity (digits) bhi milne chahiye (iPhone 15 != iPhone 16).
    function findStoreMatches(product) {
        if (!product) return {};
        buildMatchIndex();
        if (product._matches) return product._matches;

        var minName = CFG.COMPARE_MIN_NAME_MATCH || 0.65;
        var maxDiff = (CFG.COMPARE_MAX_PRICE_DIFF === undefined) ? 0.2 : CFG.COMPARE_MAX_PRICE_DIFF;
        var tokens = matchTokens(product);
        var found = {};

        if (tokens.length >= 2 && product.price) {
            var candidates = new Set();
            tokens.forEach(function (w) {
                var list = matchIndex.inv.get(w);
                if (list && list.length <= 400) list.forEach(function (i) { candidates.add(i); });
            });
            var myDigits = digitTokens(product);

            candidates.forEach(function (i) {
                var other = DATA[i];
                if (other === product || other.store === product.store) return;

                if (!sameCategory(product, other)) return;                    // Rule 1
                if (!priceWithinLimit(product, other, maxDiff)) return;       // Rule 3 (sasta check pehle)

                var ratio = nameMatchRatio(product, other);                   // Rule 2
                if (ratio < minName) return;
                if (!sameVariant(product, other)) return;                     // Pro / FE / Ultra same
                if (!sameStorage(product, other)) return;
                if (!sameSpecs(product, other)) return;                       // RAM/Storage, ml/gram/pack, clothing + accessory rules                     // 128GB vs 256GB nahi

                matchTokens(other);
                if (!sameModelNumbers(myDigits, digitTokens(other))) return;

                var gap = Math.abs(product.price - other.price) / Math.max(product.price, other.price);
                var score = ratio - gap / 10;     // naam sabse pehle, phir keemat ke kareeb wala
                if (!found[other.store] || found[other.store].score < score) {
                    found[other.store] = { score: score, product: other };
                }
            });
        }

        var result = {};
        Object.keys(found).forEach(function (store) { result[store] = found[store].product; });
        product._matches = result;
        return result;
    }

    /* ---------------- same-category suggestions ---------------- */

    function getSuggestions(product, excludeIds) {
        if (!product) return [];
        buildMatchIndex();
        var exclude = excludeIds || [];
        var skip = {};
        exclude.forEach(function (id) { skip[id] = true; });
        skip[product.id] = true;

        var pool = [];
        var seen = {};
        DATA.forEach(function (other) {
            if (skip[other.id] || !sameCategory(product, other)) return;   // pehle: category + subcategory bilkul same
            pool.push(other); seen[other.id] = true;
        });
        if (pool.length < 24) {
            DATA.forEach(function (other) {
                if (skip[other.id] || seen[other.id] || other.family !== product.family || !genderCompatible(product, other, true)) return;
                pool.push(other); seen[other.id] = true;
            });
        }
        if (pool.length < 24) {
            DATA.forEach(function (other) {
                if (skip[other.id] || seen[other.id] || other.category !== product.category || !genderCompatible(product, other, true)) return;
                pool.push(other); seen[other.id] = true;
            });
        }

        var scored = pool.map(function (other) {
            return { p: other, s: similarity(product, other) + ((other.discount || 0) / 1000) };
        });
        scored.sort(function (a, b) {
            if (b.s !== a.s) return b.s - a.s;
            return (b.p.popularity || 0) - (a.p.popularity || 0);
        });
        return scored.map(function (entry) { return entry.p; });
    }

    /* ---------------- pasted link -> product ---------------- */

    var urlIndex = null;

    function findByUrl(rawUrl) {
        var key = URLS.productKey(rawUrl);
        if (!key) return null;
        if (!urlIndex || urlIndex.count !== DATA.length) {
            urlIndex = { count: DATA.length, map: new Map() };
            DATA.forEach(function (product) {
                var k = URLS.productKey(product.link);
                if (k && !urlIndex.map.has(k)) urlIndex.map.set(k, product);
            });
        }
        return urlIndex.map.get(key) || null;
    }

    // Link ke path se product-naam jaise shabd (Flipkart / Myntra / Meesho links me hote hain)
    function slugFromUrl(rawUrl) {
        var u = URLS.parse(rawUrl);
        if (!u) return '';
        var skipSegments = { dp: 1, gp: 1, p: 1, buy: 1, s: 1, product: 1, d: 1 };
        var best = '';
        u.pathname.split('/').forEach(function (segment) {
            var s;
            try { s = decodeURIComponent(segment); } catch (e) { s = segment; }
            if (!s || skipSegments[s.toLowerCase()]) return;
            if (!/[a-z]/i.test(s) || !/[-+_]/.test(s)) return;
            if (s.length > best.length) best = s;
        });
        return best.replace(/[-+_]+/g, ' ').trim();
    }

    return {
        warmUp: function () { buildIndex(); buildMatchIndex(); },
        search: search,
        normalize: norm,
        editDistance: editDistance,
        findStoreMatches: findStoreMatches,
        getSuggestions: getSuggestions,
        findByUrl: findByUrl,
        slugFromUrl: slugFromUrl,
        similarity: similarity,
        auditCategories: auditCategories
    };
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

        priceComparisonSection: qs('#price-comparison-section'),
        priceComparisonGrid: qs('#price-comparison-grid'),
        alsoAvailableBlock: qs('#also-available-block'),
        suggestedSection: qs('#suggested-products-section'),
        suggestedGrid: qs('#suggested-products-grid'),
        suggestedSentinel: qs('#suggested-products-sentinel'),
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
            shareProductDetails: shareProductDetails,
            sanitizeUrl: window.CRACK_SHOPPING_URL.sanitize,
            engine: window.CrackShoppingEngine
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
   (dummy boAt product hata diya gaya; ab sirf asli dataset product)
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var engine = window.CrackShoppingEngine;

    var PLATFORM_PATTERNS = [
        { platform: 'amazon', hostPattern: /amazon\.|amzn\.(in|to)/i },
        { platform: 'flipkart', hostPattern: /flipkart\.com|fkrt\./i },
        { platform: 'meesho', hostPattern: /meesho\.com/i },
        { platform: 'myntra', hostPattern: /myntra\.com/i }
    ];

    var FALLBACK_IMAGE = 'crack-shopping.png';

    /* ------------------------------------------------------------
       DUAL-MODE DETECTION  (link ya keyword)
       ------------------------------------------------------------ */
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
            return { mode: 'keyword', query: trimmed };
        }

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

    function attachImageFallback(img) {
        if (!img || img.getAttribute('data-fallback-bound')) return;
        img.setAttribute('data-fallback-bound', '1');
        img.addEventListener('error', function () {
            if (img.getAttribute('data-fallback-used')) return;
            img.setAttribute('data-fallback-used', '1');
            img.setAttribute('src', FALLBACK_IMAGE);
        });
    }

    function toggleDisplay(el, visible) {
        if (!el) return;
        el.style.display = visible ? '' : 'none';
    }

    // Ek store ke liye comparison-card ka data (us store ka apna asli product).
    function toStoreData(item) {
        var hasOld = item.oldPrice && item.price && item.oldPrice > item.price;
        return {
            id: item.id,
            price: item.price,
            oldPrice: hasOld ? item.oldPrice : null,
            discount: (item.discount === null || item.discount === undefined) ? '' : item.discount + '% Off',
            link: item.link || '',
            title: item.title,
            image: item.image
        };
    }

    function renderSearchResults(parsedLink, productOverride) {
        var product = productOverride;
        if (!product) return;   // dummy fallback nahi: asli product hi dikhta hai

        var platform = product.store;

        // SIRF asli matches: dusre store ke data me jo product sach me maujood hai.
        var matches = engine.findStoreMatches(product);
        var prices = {};
        prices[product.store] = toStoreData(product);
        Object.keys(matches).forEach(function (storeName) {
            if (matches[storeName] && matches[storeName].price) {
                prices[storeName] = toStoreData(matches[storeName]);
            }
        });
        var priceInfo = prices[product.store];

        state.activeSearchMode = 'url';
        state.searchedProduct = {
            product: product,
            platform: platform,
            searchedUrl: (parsedLink && parsedLink.url && parsedLink.url.href) || product.link || ''
        };

        if (dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'visible');
        }

        if (window.CrackShopping.navigation) {
            window.CrackShopping.navigation.setHeroTextVisibility(false);
            window.CrackShopping.navigation.scrollToTop();
        }

        utils.setText(dom.searchedProductName, product.title.split(' ').slice(0, 3).join(' '));

        if (dom.mainProductImage) {
            attachImageFallback(dom.mainProductImage);
            dom.mainProductImage.removeAttribute('data-fallback-used');
            dom.mainProductImage.setAttribute('src', product.image || FALLBACK_IMAGE);
            dom.mainProductImage.setAttribute('alt', product.title);
        }
        utils.setText(dom.mainProductTitle, product.title);

        // Dataset me rating / specs hain hi nahi - dummy "4.2 stars / Bluetooth 5.0" chhupa do.
        var hasRating = !!product.rating;
        utils.setText(dom.ratingValue, hasRating ? '(' + product.rating + ')' : '');
        utils.setText(dom.ratingCount, product.reviewsCount ? product.reviewsCount + ' ratings' : '');
        toggleDisplay(utils.qs('#main-product-rating-row'), hasRating);
        toggleDisplay(utils.qs('#main-product-specs-list'), !!(product.specs && product.specs.length));

        var platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
        utils.setText(dom.priceBlockLabel, 'Price on ' + platformLabel);
        utils.setText(dom.priceBlockCurrent, priceInfo.price ? utils.formatPrice(priceInfo.price) : 'Check price on store');
        utils.setText(dom.priceBlockOld, (priceInfo.price && priceInfo.oldPrice) ? utils.formatPrice(priceInfo.oldPrice) : '');
        utils.setText(dom.priceBlockDiscountTag, priceInfo.discount);
        toggleDisplay(dom.priceBlockDiscountTag, !!priceInfo.discount);

        if (dom.buyOnAmazonBtn) {
            var btnTextEl = utils.qs('.btn-text', dom.buyOnAmazonBtn);
            if (btnTextEl) {
                utils.setText(btnTextEl, 'Buy on ' + platformLabel);
            }
            utils.setAttr(dom.buyOnAmazonBtn, 'data-store', platform);
            utils.setAttr(dom.buyOnAmazonBtn, 'href', product.link || utils.buildStoreSearchUrl(platform, product.title));
        }

        document.dispatchEvent(new CustomEvent('crackshopping:searchResultsUpdated', {
            detail: { product: product, platform: platform, prices: prices, matches: matches }
        }));
    }

    // Dataset ke kisi bhi product ko "searched product" ki tarah kholta hai.
    function openProduct(productItem) {
        if (!productItem) return;
        var url;
        try { url = new URL(productItem.link || ('https://www.' + productItem.store + '.com/')); }
        catch (e) { url = new URL('https://www.' + productItem.store + '.com/'); }
        renderSearchResults({ valid: true, url: url, platform: productItem.store, reason: null }, productItem);
    }

    function handleUrlSearch(detection) {
        var platform = detectPlatformFromUrl(detection.url);

        if (!platform) {
            hideUrlSearchResults();
            showSearchError('This link isn\'t from a supported store yet. Try Amazon, Flipkart, Meesho or Myntra.');
            return;
        }

        // 1) Pasted link ko dataset ke asli product se milao (ASIN / itm id / product id se)
        var known = engine.findByUrl(detection.url.href);
        if (known) {
            renderSearchResults({ valid: true, url: detection.url, platform: platform, reason: null }, known);
            return;
        }

        // 2) Exact product nahi mila: link ke naam-shabdon se milte-julte products dikhao
        var slug = engine.slugFromUrl(detection.url.href);
        hideUrlSearchResults();
        if (slug) {
            handleKeywordSearch(slug);
            showSearchError('We couldn\'t find this exact product in our database. Showing similar products instead.');
        } else {
            showSearchError('This product isn\'t in our database yet. Try searching by product name.');
        }
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
        openProduct: openProduct,
        hideUrlSearchResults: hideUrlSearchResults,
        clearSearchError: clearSearchError,
        attachImageFallback: attachImageFallback,
        FALLBACK_IMAGE: FALLBACK_IMAGE
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
       KEYWORD / TEXT SEARCH  (Smart + Fuzzy)
       ------------------------------------------------------------
       Asli kaam CrackShoppingEngine (upar) karta hai:
         - spelling galti (hedfon -> headphone, samsng -> samsung)
         - Hinglish / Hindi (kar, gaadi, कार -> car)
         - shabd ka shuruaati hissa (head -> headphone), plural/singular
       Naya Hindi / Hinglish shabd sikhana ho to engine me INTENTS list me jodein.
       ============================================================ */

    var engine = window.CrackShoppingEngine;
    var searchApi = window.CrackShopping.search || {};
    var lastSearchMeta = { query: '', corrected: '' };

    function getProductsByKeyword(rawQuery) {
        var result = engine.search(rawQuery);
        lastSearchMeta = { query: rawQuery, corrected: result.corrected };
        return result.results;
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
        // lazy: 3000+ products ki images ek saath load nahi hoti -> page halka rehta hai
        img.setAttribute('loading', 'lazy');
        img.setAttribute('decoding', 'async');
        if (searchApi.attachImageFallback) { searchApi.attachImageFallback(img); }
        img.setAttribute('src', productItem.image || (searchApi.FALLBACK_IMAGE || 'crack-shopping.png'));
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

        // Spelling / Hinglish se sudhaara gaya ho to bata do: "Showing results for 'car'"
        if (matched.length && lastSearchMeta.corrected && dom.bestDealsGrid) {
            var note = document.createElement('p');
            note.className = 'no-results-message search-correction-note';
            note.appendChild(document.createTextNode('Showing results for \u201C'));
            var strong = document.createElement('strong');
            utils.setText(strong, lastSearchMeta.corrected);
            note.appendChild(strong);
            note.appendChild(document.createTextNode('\u201D'));
            dom.bestDealsGrid.insertBefore(note, dom.bestDealsGrid.firstChild);
        }

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

    // Category button dabane par "Best Deals" heading me category ka naam + total products dikhao
    // (jaise "Mobile - 249 Deals"). Category hatne par purana heading wapas.
    var bestDealsHeading = document.getElementById('best-deals-heading');
    var DEFAULT_HEADING_TEXT = 'Best Deals Right Now';
    document.addEventListener('crackshopping:categoryChanged', function (event) {
        if (!bestDealsHeading || !bestDealsHeading.lastChild) return;
        var detail = event.detail || {};
        var text = DEFAULT_HEADING_TEXT;
        if (detail.category) {
            var activeBtn = utils.qs('.category-btn.is-active');
            var labelEl = activeBtn ? utils.qs('.category-btn-text', activeBtn) : null;
            if (labelEl) {
                text = labelEl.textContent.trim() + ' \u2013 ' + detail.count + ' Deals';
            }
        }
        // heading ka last child text-node hai (icon span alag rehta hai)
        bestDealsHeading.lastChild.textContent = '\n                            ' + text + '\n                        ';
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
   PART 5 — Infinite Scroll / More Deals  (rewritten)
   ------------------------------------------------------------
   Pehle: 4-4 product, 500ms delay, aur IntersectionObserver sirf tab chalta
   tha jab sentinel screen me "aata/jaata" tha -> scroll beech me ruk jaata tha.
   Ab: ek baar me 24 cards, turant render, har batch ke baad check karta hai ki
   sentinel abhi bhi screen ke paas hai ya nahi (to agla batch khud load),
   observer + passive scroll listener dono. Pool sirf reset par ek baar banta hai.
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var productsApi = window.CrackShopping.products;

    if (!productsApi) return;

    var PRODUCT_DATASET = productsApi.PRODUCT_DATASET;
    var renderProductsIntoGrid = productsApi.renderProductsIntoGrid;

    var MORE_DEALS_PAGE_SIZE = 24;      // ek baar me 20-30 products
    var PRELOAD_DISTANCE_PX = 700;      // sentinel screen se itna door ho tab hi agla batch

    var pool = null;                    // is category / search / filter ka poora product-pool

    /**
     * "More Great Deals" ka pool: wahi category / keyword / advanced filters / sort
     * jo Best Deals grid par laagu hain, aur Best Deals me dikh chuke products hata kar.
     * Sirf resetInfiniteScroll() me ek baar banta hai (har scroll par nahi).
     */
    function buildMoreDealsPool() {
        var basePool = (state.activeSearchMode === 'keyword' && typeof productsApi.getProductsByKeyword === 'function')
            ? productsApi.getProductsByKeyword(state.activeKeywordQuery)
            : productsApi.getProductsByCategory(state.activeCategory);
        var advancedFiltersApi = window.CrackShopping.advancedFilters;

        var list = basePool;
        if (advancedFiltersApi && typeof advancedFiltersApi.productMatchesFilters === 'function') {
            list = basePool.filter(function (productItem) {
                return advancedFiltersApi.productMatchesFilters(productItem, state.activeFilters);
            });
        }

        // Keyword search apni relevance-order rakhta hai; sort sirf tab jab user ne chuna ho.
        var sortBy = state.activeFilters.sortBy;
        if (advancedFiltersApi && typeof advancedFiltersApi.sortProducts === 'function' &&
            !(state.activeSearchMode === 'keyword' && (!sortBy || sortBy === 'popular'))) {
            list = advancedFiltersApi.sortProducts(list, sortBy);
        }

        var excluded = {};
        (state.deals.currentlyDisplayedIds || []).forEach(function (id) { excluded[id] = true; });
        return list.filter(function (productItem) { return !excluded[productItem.id]; });
    }

    function showEndOfResultsMessage() {
        if (!dom.moreDealsGrid) return;
        if (utils.qs('#more-deals-end-message')) return;

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

    // Search / link-result mode me ye section CSS se display:none hota hai (offsetParent == null).
    function isSectionVisible() {
        return !!(dom.moreDealsScrollSentinel && dom.moreDealsScrollSentinel.offsetParent !== null);
    }

    function isSentinelNearViewport() {
        if (!isSectionVisible()) return false;
        var rect = dom.moreDealsScrollSentinel.getBoundingClientRect();
        return rect.top <= window.innerHeight + PRELOAD_DISTANCE_PX;
    }

    function loadMoreDeals() {
        if (state.deals.isLoading || state.deals.isExhausted) return;
        if (!dom.moreDealsGrid) return;
        if (!PRODUCT_DATASET.length) return;      // products.json abhi aayi nahi
        if (!isSectionVisible()) return;          // section chhupa hai (search results dikh rahe hain)

        state.deals.isLoading = true;

        if (!pool) pool = buildMoreDealsPool();

        var startIndex = state.deals.moreDealsRendered;
        var nextBatch = pool.slice(startIndex, startIndex + MORE_DEALS_PAGE_SIZE);

        if (nextBatch.length === 0) {
            state.deals.isExhausted = true;
            showEndOfResultsMessage();
            state.deals.isLoading = false;
            return;
        }

        renderProductsIntoGrid(dom.moreDealsGrid, nextBatch, true);
        state.deals.moreDealsRendered = startIndex + nextBatch.length;

        if (state.deals.moreDealsRendered >= pool.length) {
            state.deals.isExhausted = true;
            showEndOfResultsMessage();
        }

        state.deals.isLoading = false;

        // Layout settle hone ke baad dekho: agar sentinel abhi bhi screen ke paas hai
        // (badi screen / kam cards) to agla batch bhi turant load karo.
        window.requestAnimationFrame(function () {
            if (!state.deals.isExhausted && isSentinelNearViewport()) {
                loadMoreDeals();
            }
        });
    }

    function resetInfiniteScroll() {
        pool = null;
        state.deals.moreDealsRendered = 0;
        state.deals.isLoading = false;
        state.deals.isExhausted = false;
        removeEndOfResultsMessage();

        if (dom.moreDealsGrid) {
            dom.moreDealsGrid.textContent = '';
        }

        loadMoreDeals();
    }

    /* ---- triggers: IntersectionObserver + (hamesha) passive scroll listener ---- */

    if ('IntersectionObserver' in window && dom.moreDealsScrollSentinel) {
        var scrollObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    loadMoreDeals();
                }
            });
        }, {
            root: null,
            rootMargin: PRELOAD_DISTANCE_PX + 'px 0px',
            threshold: 0
        });

        scrollObserver.observe(dom.moreDealsScrollSentinel);
    }

    // Backup: kuch browsers / layouts me observer sentinel ke "bheetar hi rehne" par dobara fire nahi karta.
    var scrollTicking = false;
    function onScrollOrResize() {
        if (scrollTicking) return;
        scrollTicking = true;
        window.requestAnimationFrame(function () {
            scrollTicking = false;
            if (!state.deals.isExhausted && isSentinelNearViewport()) {
                loadMoreDeals();
            }
        });
    }
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    document.addEventListener('crackshopping:categoryChanged', resetInfiniteScroll);
    document.addEventListener('crackshopping:keywordSearchApplied', resetInfiniteScroll);

    // Search-result band hone par (section dobara dikhe) pool fresh se bano.
    document.addEventListener('crackshopping:homeReset', function () {
        // applyCategoryFilter('') -> categoryChanged pehle hi reset kar chuka hai;
        // yahan sirf tab jab abhi tak kuch render nahi hua.
        if (!state.deals.moreDealsRendered && !state.deals.isExhausted) {
            resetInfiniteScroll();
        }
    });

    loadMoreDeals();

    window.CrackShopping.infiniteScroll = {
        loadMoreDeals: loadMoreDeals,
        resetInfiniteScroll: resetInfiniteScroll,
        PAGE_SIZE: MORE_DEALS_PAGE_SIZE
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
   PART 7 — Product Comparison Modal + product-card clicks
   (modal me bhi ab dummy price nahi: sirf asli store-matches)
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var productsApi = window.CrackShopping.products;
    var engine = window.CrackShoppingEngine;

    if (!productsApi) return;

    var PRODUCT_DATASET = productsApi.PRODUCT_DATASET;
    var ALL_STORES = ['amazon', 'flipkart', 'meesho', 'myntra'];

    // Sirf wahi stores jinke data me ye product sach me maujood hai.
    function buildRealComparison(productItem) {
        var comparison = {};
        var matches = engine.findStoreMatches(productItem);

        function entry(item) {
            var hasOld = item.oldPrice && item.price && item.oldPrice > item.price;
            return {
                price: item.price,
                oldPrice: hasOld ? item.oldPrice : null,
                discount: (item.discount === null || item.discount === undefined) ? '' : item.discount + '% Off',
                link: item.link || utils.buildStoreSearchUrl(item.store, item.title)
            };
        }

        if (productItem.price) comparison[productItem.store] = entry(productItem);
        Object.keys(matches).forEach(function (storeName) {
            if (matches[storeName] && matches[storeName].price) {
                comparison[storeName] = entry(matches[storeName]);
            }
        });
        return comparison;
    }

    function openProductComparisonModal(productItem) {
        if (!dom.productComparisonModal || !productItem) return;

        var comparisonPrices = buildRealComparison(productItem);
        state.activeComparisonProduct = {
            product: productItem,
            comparisonPrices: comparisonPrices
        };

        if (dom.modalProductImage) {
            dom.modalProductImage.setAttribute('src', productItem.image || 'crack-shopping.png');
            dom.modalProductImage.setAttribute('alt', productItem.title);
        }
        utils.setText(dom.modalProductTitle, productItem.title);

        // dataset me rating nahi hai -> dummy stars chhupa do
        var ratingRow = utils.qs('#modal-product-rating-row');
        if (ratingRow) {
            ratingRow.style.display = productItem.rating ? '' : 'none';
        }
        if (productItem.rating) {
            utils.setText(dom.modalRatingStars, '\u2605\u2605\u2605\u2605\u2606');
            utils.setText(dom.modalRatingValue, '(' + productItem.rating + ')');
        }

        ALL_STORES.forEach(function (storeName) {
            var storeData = comparisonPrices[storeName];
            var rowEl = utils.qs('#modal-price-row-' + storeName);
            if (!rowEl) return;

            if (!storeData) {
                rowEl.style.display = 'none';
                return;
            }
            rowEl.style.display = '';

            utils.setText(utils.qs('#modal-price-' + storeName), utils.formatPrice(storeData.price));
            utils.setText(utils.qs('#modal-discount-' + storeName), storeData.discount);
            var discountEl = utils.qs('#modal-discount-' + storeName);
            if (discountEl) discountEl.style.display = storeData.discount ? '' : 'none';

            var actionBtn = utils.qs('.modal-store-action-btn', rowEl);
            if (actionBtn) {
                utils.setAttr(actionBtn, 'href', storeData.link);
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

    // id -> product (O(1)); dataset ek baar load hone ke baad map banta hai.
    var idMap = null;
    var idMapCount = -1;

    function findProductById(productId) {
        if (!idMap || idMapCount !== PRODUCT_DATASET.length) {
            idMap = {};
            PRODUCT_DATASET.forEach(function (item) { idMap[item.id] = item; });
            idMapCount = PRODUCT_DATASET.length;
        }
        return idMap[productId] || null;
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
        if (searchApi && typeof searchApi.openProduct === 'function') {
            searchApi.openProduct(productItem);
        }
    }

    utils.on(dom.bestDealsGrid, 'click', handleProductGridClick);
    utils.on(dom.moreDealsGrid, 'click', handleProductGridClick);
    utils.on(dom.suggestedGrid, 'click', handleProductGridClick);   // "You May Also Like" cards

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

    // Real <a href target=_blank> links: sirf log, preventDefault nahi
    // (Cuelinks apna kaam click par khud karta hai).
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
   PART 9 — Search Results + Real Comparison + Suggested Products
   ------------------------------------------------------------
   - Comparison cards sirf un stores ke dikhte hain jinke data me
     product sach me maujood hai (baaki cards chhup jaate hain).
   - Har card apne store ka asli title / image / (saaf) link dikhata hai.
   - Comparison ke neeche "You May Also Like" (Suggested Products):
     usi category ke asli products, scroll karne par aur load hote hain.
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

    var dom = window.CrackShopping.dom;
    var state = window.CrackShopping.state;
    var utils = window.CrackShopping.utils;
    var searchApi = window.CrackShopping.search;
    var productsApi = window.CrackShopping.products;
    var engine = window.CrackShoppingEngine;
    var CFG = window.CRACK_SHOPPING_CONFIG;

    if (!searchApi) return;

    var COMPARISON_CARD_CONFIG = [
        { store: 'amazon', cardEl: dom.comparisonCardAmazon },
        { store: 'flipkart', cardEl: dom.comparisonCardFlipkart },
        { store: 'meesho', cardEl: dom.comparisonCardMeesho },
        { store: 'myntra', cardEl: dom.comparisonCardMyntra }
    ];

    // Comparison cards / modal ki static images ke liye fallback (toote link par logo dikhe).
    utils.qsa('.comparison-card-image, .modal-product-image, .main-product-image').forEach(function (img) {
        searchApi.attachImageFallback(img);
    });

    // Real <a href target=_blank> links: sirf log, preventDefault nahi.
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

    function showEl(el, visible) {
        if (el) el.style.display = visible ? '' : 'none';
    }

    function updateComparisonCard(cardEl, storeName, storeData, lowestPrice) {
        if (!cardEl) return;

        var priceCurrentEl = utils.qs('.comparison-price-current', cardEl);
        var priceOldEl = utils.qs('.comparison-price-old', cardEl);
        var titleEl = utils.qs('.comparison-card-title', cardEl);
        var diffTagEl = utils.qs('.comparison-price-diff-tag', cardEl);
        var discountTagEl = utils.qs('.discount-tag', cardEl);
        var imageEl = utils.qs('.comparison-card-image', cardEl);
        var storeActionBtn = utils.qs('.view-on-store-btn', cardEl);

        utils.setText(priceCurrentEl, utils.formatPrice(storeData.price));
        utils.setText(priceOldEl, storeData.oldPrice ? utils.formatPrice(storeData.oldPrice) : '');
        utils.setText(titleEl, storeData.title);
        utils.setText(discountTagEl, storeData.discount);
        showEl(discountTagEl, !!storeData.discount);

        if (storeActionBtn) {
            // Is store ka asli (saaf) product link; link na ho to us store ka search-URL.
            utils.setAttr(storeActionBtn, 'href', storeData.link || utils.buildStoreSearchUrl(storeName, storeData.title));
        }

        if (imageEl) {
            imageEl.removeAttribute('data-fallback-used');
            imageEl.setAttribute('src', storeData.image || searchApi.FALLBACK_IMAGE);
            imageEl.setAttribute('alt', storeData.title);
        }

        if (storeData.price === lowestPrice) {
            utils.setText(diffTagEl, 'Sabse Sasta Deal');
            diffTagEl.classList.add('comparison-price-diff-lowest');
        } else {
            utils.setText(diffTagEl, utils.formatPrice(storeData.price - lowestPrice) + ' Mehnga');
            diffTagEl.classList.remove('comparison-price-diff-lowest');
        }
    }

    function syncComparisonGridWithSearchedProduct(product, prices) {
        var availableStores = COMPARISON_CARD_CONFIG.filter(function (config) {
            return prices[config.store] && prices[config.store].price;
        });
        var lowestPrice = Math.min.apply(null, availableStores.map(function (config) {
            return prices[config.store].price;
        }));

        COMPARISON_CARD_CONFIG.forEach(function (config) {
            var storeData = prices[config.store];
            var isAvailable = !!(storeData && storeData.price);
            showEl(config.cardEl, isAvailable);          // jo store me product nahi, uska card chhupa
            if (isAvailable) {
                updateComparisonCard(config.cardEl, config.store, storeData, lowestPrice);
            }
        });

        // Comparison tabhi dikhao jab kam se kam 2 stores par asli product ho.
        showEl(dom.priceComparisonSection, availableStores.length >= 2);

        // "Also Available on": sirf wo dusre stores jahan product sach me hai.
        var otherStores = availableStores.map(function (c) { return c.store; })
            .filter(function (storeName) { return storeName !== product.store; });
        ['amazon', 'flipkart', 'meesho', 'myntra'].forEach(function (storeName) {
            showEl(utils.qs('#also-available-' + storeName), otherStores.indexOf(storeName) !== -1);
        });
        showEl(dom.alsoAvailableBlock, otherStores.length > 0);
    }

    /* ------------------------------------------------------------
       SUGGESTED PRODUCTS  ("You May Also Like")
       ------------------------------------------------------------ */
    var SUGGESTIONS_PAGE_SIZE = CFG.SUGGESTIONS_PAGE_SIZE || 12;
    var suggestions = { list: [], rendered: 0 };

    function isSuggestionsVisible() {
        return !!(dom.suggestedSentinel && dom.suggestedSentinel.offsetParent !== null);
    }

    function loadMoreSuggestions() {
        if (!dom.suggestedGrid || !productsApi) return;
        if (!isSuggestionsVisible()) return;
        if (suggestions.rendered >= suggestions.list.length) return;

        var batch = suggestions.list.slice(suggestions.rendered, suggestions.rendered + SUGGESTIONS_PAGE_SIZE);
        productsApi.renderProductsIntoGrid(dom.suggestedGrid, batch, true);
        suggestions.rendered += batch.length;

        // Wahi product "More Deals" grid me bhi (chhupa hua) ho sakta hai -> duplicate DOM ids hatao.
        // (clicks data-product-id se chalte hain, id ki zarurat nahi)
        utils.qsa('[id]', dom.suggestedGrid).forEach(function (el) { el.removeAttribute('id'); });

        // sentinel abhi bhi screen ke paas ho (badi screen) to agla batch bhi load
        window.requestAnimationFrame(function () {
            if (suggestions.rendered < suggestions.list.length && isSuggestionsNearViewport()) {
                loadMoreSuggestions();
            }
        });
    }

    function isSuggestionsNearViewport() {
        if (!isSuggestionsVisible()) return false;
        return dom.suggestedSentinel.getBoundingClientRect().top <= window.innerHeight + 600;
    }

    function clearSuggestions() {
        suggestions = { list: [], rendered: 0 };
        if (dom.suggestedGrid) dom.suggestedGrid.textContent = '';
        showEl(dom.suggestedSection, false);
    }

    function renderSuggestions(product, prices) {
        clearSuggestions();
        if (!dom.suggestedSection || !dom.suggestedGrid || !productsApi) return;

        // comparison me jo products already dikh rahe hain unhe dobara suggest nahi karte
        var exclude = [];
        Object.keys(prices).forEach(function (storeName) {
            if (prices[storeName] && prices[storeName].id) exclude.push(prices[storeName].id);
        });

        suggestions.list = engine.getSuggestions(product, exclude);
        if (!suggestions.list.length) return;

        showEl(dom.suggestedSection, true);
        loadMoreSuggestions();
    }

    if ('IntersectionObserver' in window && dom.suggestedSentinel) {
        new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) loadMoreSuggestions();
            });
        }, { root: null, rootMargin: '600px 0px', threshold: 0 }).observe(dom.suggestedSentinel);
    }

    var suggestionsTicking = false;
    window.addEventListener('scroll', function () {
        if (suggestionsTicking) return;
        suggestionsTicking = true;
        window.requestAnimationFrame(function () {
            suggestionsTicking = false;
            if (suggestions.rendered < suggestions.list.length && isSuggestionsNearViewport()) {
                loadMoreSuggestions();
            }
        });
    }, { passive: true });

    document.addEventListener('crackshopping:searchResultsUpdated', function (event) {
        var detail = event.detail || {};
        if (!detail.product || !detail.prices) return;
        syncComparisonGridWithSearchedProduct(detail.product, detail.prices);
        renderSuggestions(detail.product, detail.prices);
    });

    function hideSearchResultsAfterBrowse(resetError) {
        if (state.searchedProduct && dom.searchResultsSection) {
            utils.setAttr(dom.searchResultsSection, 'data-visibility', 'hidden');
            state.searchedProduct = null;
            if (resetError) searchApi.clearSearchError();
            if (window.CrackShopping.navigation) {
                window.CrackShopping.navigation.setHeroTextVisibility(true);
            }
        }
        clearSuggestions();
        // Home sections wapas dikhne lage: infinite scroll ko turant kaam par lagao.
        if (window.CrackShopping.infiniteScroll) {
            window.CrackShopping.infiniteScroll.loadMoreDeals();
        }
    }

    document.addEventListener('crackshopping:categoryChanged', function () { hideSearchResultsAfterBrowse(true); });
    document.addEventListener('crackshopping:keywordSearchApplied', function () { hideSearchResultsAfterBrowse(true); });
    document.addEventListener('crackshopping:filtersApplied', function () { hideSearchResultsAfterBrowse(false); });

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
        clearSuggestions();

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
        getCurrentAppSnapshot: getCurrentAppSnapshot,
        renderSuggestions: renderSuggestions
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

    // Har store ke itne products hi JSON-LD schema me jaate hain (page halka rakhne ke liye).
    var SCHEMA_ITEMS_PER_STORE = 50;

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
        // outgoing link hamesha saaf (purane tracking params hate hue)
        var cleanLink = window.CRACK_SHOPPING_URL ? window.CRACK_SHOPPING_URL.sanitize(item.link, storeKey) : item.link;
        var hasLivePrice = (item.price !== null && item.price !== undefined);
        var effectivePrice = hasLivePrice ? item.price : item.mrp;
        var availability = hasLivePrice
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock';

        var schema = {
            '@type': 'Product',
            'name': item.name,
            'image': [resolveImageUrl(item.image)],
            'url': cleanLink,
            'offers': {
                '@type': 'Offer',
                'url': cleanLink,
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
            // Poore 1500+ products head me daalna page ko bhaari karta hai; Google ko top deals kaafi hain.
            items = items.filter(function (item) { return item.price !== null && item.price !== undefined; }).slice(0, SCHEMA_ITEMS_PER_STORE);
            if (!items.length) return;
            var listSchema = buildItemListSchema(storeKey, items);
            injectJsonLd('jsonld-products-' + storeKey, listSchema);
        });
    }

    function loadProductsAndInjectSchema() {
        // products.json dobara download nahi hoti: loader ka same data use hota hai.
        var ready = window.CRACK_SHOPPING_PRODUCTS_READY;
        if (!ready || typeof ready.then !== 'function') return;

        ready.then(function (productsData) {
            if (productsData) renderAllStoreSchemas(productsData);
        }).catch(function (err) {
            console.warn('[Crack Shopping] Could not build SEO schema:', err);
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