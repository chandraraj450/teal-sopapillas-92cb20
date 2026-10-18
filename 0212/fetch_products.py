#!/usr/bin/env python3
"""
Crack Shopping - automatic products.json builder
=================================================
Collects trending products from Amazon.in, Flipkart, Myntra and Meesho and
writes them to products.json in the SAME structure your site (script.js)
already reads:

    { "amazon": [ {...}, ... ], "flipkart": [...], "meesho": [...], "myntra": [...] }

Every product contains the keys script.js needs (id, category, name, image,
mrp, price, discount, link) plus the extra keys you asked for (title, store,
rating, originalPrice, buyUrl). script.js ignores keys it does not use.

buyUrl / link are CLEAN product URLs - Cuelinks (cuelinksv2.js) converts them
on click, so no affiliate parameters are added here.

Safety: if a store/category returns too little data (blocked, layout changed),
the previous data for that store/category is kept. products.json is never
wiped, and the script exits with an error if NOTHING could be fetched.

Environment variables (all optional)
    PER_CATEGORY   products per store per category      (default 6)
    PROXY_URL      http(s) proxy, e.g. a residential/scraping proxy
    USE_BROWSER    "1" = render pages with Playwright (needed for JS-heavy pages)
    DELAY_MIN / DELAY_MAX   seconds between requests    (default 3 / 6)
"""
from __future__ import annotations

import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

OUTPUT_FILE = Path(os.getenv("OUTPUT_FILE", "products.json"))
PER_CATEGORY = int(os.getenv("PER_CATEGORY", "6"))
MIN_PER_CATEGORY = 2          # fewer than this => keep old data for that category
DELAY_MIN = float(os.getenv("DELAY_MIN", "3"))
DELAY_MAX = float(os.getenv("DELAY_MAX", "6"))
USE_BROWSER = os.getenv("USE_BROWSER") == "1"
PROXY_URL = os.getenv("PROXY_URL") or None

# category label -> search keyword per store (omit a store = skip it there).
# Labels already known to script.js are kept exactly as-is.
CATEGORIES: list[tuple[str, dict[str, str]]] = [
    ("Headphones / Audio", {"amazon": "bluetooth headphones", "flipkart": "bluetooth headphones",
                            "myntra": "headphones", "meesho": "bluetooth earphones"}),
    ("Smartwatches", {"amazon": "smart watch", "flipkart": "smart watch",
                      "myntra": "smart watches", "meesho": "smart watch"}),
    ("Mobile Accessories", {"amazon": "mobile accessories", "flipkart": "mobile accessories",
                            "myntra": "phone cases", "meesho": "mobile cover"}),
    ("Kitchen Appliances", {"amazon": "kitchen appliances", "flipkart": "kitchen appliances",
                            "meesho": "kitchen appliances"}),
    ("toys", {"amazon": "toys", "flipkart": "toys", "myntra": "toys", "meesho": "toys"}),
    ("Electronics", {"amazon": "electronics gadgets", "flipkart": "electronics gadgets",
                     "meesho": "electronic gadgets"}),
    ("Fashion", {"amazon": "men fashion clothing", "flipkart": "women fashion clothing",
                 "myntra": "tshirts", "meesho": "kurti"}),
    ("Footwear", {"amazon": "sports shoes", "flipkart": "sneakers", "myntra": "sneakers",
                  "meesho": "sandals"}),
    ("Beauty", {"amazon": "beauty skincare", "flipkart": "beauty skincare",
                "myntra": "lipstick", "meesho": "makeup"}),
    ("Home & Kitchen", {"amazon": "home kitchen", "flipkart": "home decor",
                        "myntra": "home furnishing", "meesho": "home decor"}),
]

UA_POOL = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
]

SESSION = requests.Session()
if PROXY_URL:
    SESSION.proxies = {"http": PROXY_URL, "https": PROXY_URL}


def log(msg: str) -> None:
    print(msg, flush=True)


def pause() -> None:
    time.sleep(random.uniform(DELAY_MIN, DELAY_MAX))


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #
def _headers(extra: dict | None = None) -> dict:
    h = {
        "User-Agent": random.choice(UA_POOL),
        "Accept-Language": "en-IN,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    h.update(extra or {})
    return h


def fetch(url: str, *, extra_headers: dict | None = None, retries: int = 3) -> str | None:
    """Return response text or None when blocked / failed."""
    if USE_BROWSER:
        return fetch_browser(url)
    for attempt in range(1, retries + 1):
        try:
            r = SESSION.get(url, headers=_headers(extra_headers), timeout=30)
            blocked = r.status_code in (403, 429, 503) or "captcha" in r.text[:5000].lower()
            if r.status_code == 200 and not blocked:
                return r.text
            log(f"    HTTP {r.status_code}{' (blocked/captcha)' if blocked else ''} - attempt {attempt}")
        except requests.RequestException as exc:
            log(f"    network error: {exc} - attempt {attempt}")
        time.sleep(attempt * 4 + random.random() * 2)
    return None


_PW: dict[str, Any] = {}


def fetch_browser(url: str) -> str | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("USE_BROWSER=1 but playwright is not installed (pip install playwright && playwright install chromium)")
    try:
        if "page" not in _PW:
            _PW["pw"] = sync_playwright().start()
            launch = {"headless": True}
            if PROXY_URL:
                launch["proxy"] = {"server": PROXY_URL}
            _PW["browser"] = _PW["pw"].chromium.launch(**launch)
            ctx = _PW["browser"].new_context(user_agent=UA_POOL[0], locale="en-IN",
                                             viewport={"width": 1366, "height": 900})
            _PW["page"] = ctx.new_page()
        page = _PW["page"]
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        for _ in range(4):                       # trigger lazy loading
            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(600)
        return page.content()
    except Exception as exc:                     # noqa: BLE001
        log(f"    browser error: {exc}")
        return None


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def money(text: Any) -> int | None:
    if text is None:
        return None
    if isinstance(text, (int, float)):
        return int(text) if text > 0 else None
    m = re.search(r"(\d[\d,]*)(?:\.\d+)?", str(text))
    if not m:
        return None
    v = int(m.group(1).replace(",", ""))
    return v if v > 0 else None


def rating_of(text: Any) -> float | None:
    try:
        v = float(re.search(r"\d(?:\.\d)?", str(text)).group(0))
        return v if 0 < v <= 5 else None
    except (AttributeError, ValueError):
        return None


def make_product(store: str, pid: str, category: str, name: str, image: str,
                 price: int | None, mrp: int | None, rating: float | None, url: str) -> dict | None:
    name = re.sub(r"\s+", " ", (name or "")).strip()
    if not (name and price and image.startswith("http") and url.startswith("http")):
        return None
    if not mrp or mrp < price:
        mrp = price
    discount = round((mrp - price) * 100 / mrp)
    return {
        "id": f"{store[:3]}-{pid}",
        "category": category,
        "name": name,
        "title": name,
        "store": store,
        "image": image.replace("http://", "https://"),
        "mrp": mrp,
        "originalPrice": mrp,
        "price": price,
        "discount": discount,
        "rating": rating,
        "link": url,
        "buyUrl": url,
    }


# --------------------------------------------------------------------------- #
# Amazon.in  (search results sorted by popularity)
# --------------------------------------------------------------------------- #
def parse_amazon(html: str, category: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out = []
    for card in soup.select('div[data-component-type="s-search-result"][data-asin]'):
        asin = card.get("data-asin", "").strip()
        if not asin or "AdHolder" in " ".join(card.get("class", [])):
            continue
        h2 = card.select_one("h2")
        name = (h2.get("aria-label") or h2.get_text(" ", strip=True)) if h2 else ""
        img = card.select_one("img.s-image")
        price = card.select_one("span.a-price:not(.a-text-price) span.a-offscreen")
        mrp = card.select_one("span.a-price.a-text-price span.a-offscreen")
        rate = card.select_one("span.a-icon-alt")
        p = make_product("amazon", asin, category, name, img.get("src", "") if img else "",
                         money(price.get_text()) if price else None,
                         money(mrp.get_text()) if mrp else None,
                         rating_of(rate.get_text()) if rate else None,
                         f"https://www.amazon.in/dp/{asin}")
        if p:
            out.append(p)
    return out


def fetch_amazon(query: str, category: str) -> list[dict]:
    url = f"https://www.amazon.in/s?k={quote(query)}&s=exact-aware-popularity-rank"
    html = fetch(url)
    return parse_amazon(html, category) if html else []


# --------------------------------------------------------------------------- #
# Flipkart  (layout-tolerant: finds product links, then reads text around them)
# --------------------------------------------------------------------------- #
def parse_flipkart(html: str, category: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    out, seen = [], set()
    for a in soup.select('a[href*="/p/itm"]'):
        href = a.get("href", "")
        m = re.search(r"/p/(itm\w+)", href)
        if not m or m.group(1) in seen:
            continue
        box = a
        for _ in range(5):                       # climb until the card (has a rupee price)
            if "₹" in box.get_text() and box.select_one("img"):
                break
            if box.parent is None:
                break
            box = box.parent
        text = box.get_text(" ", strip=True)
        prices = [money(x) for x in re.findall(r"₹\s?([\d,]+)", text)]
        prices = [p for p in prices if p]
        if not prices:
            continue
        img = next((i for i in box.select("img")
                    if "rukminim" in (i.get("src") or i.get("data-src") or "")), None)
        if not img:
            continue
        src = img.get("src") or img.get("data-src")
        src = re.sub(r"/image/\d+/\d+/", "/image/416/416/", src)
        name = img.get("alt") or a.get("title") or ""
        if len(name) < 8:
            name = max((t for t in box.stripped_strings if "₹" not in t), key=len, default="")
        rate = re.search(r"\b([1-5]\.\d)\b", text)
        pid = parse_qs(urlparse(href).query).get("pid", [m.group(1)])[0]
        link = "https://www.flipkart.com" + href.split("?")[0] + (f"?pid={pid}" if pid != m.group(1) else "")
        mrp = prices[1] if len(prices) > 1 and prices[1] > prices[0] else None
        p = make_product("flipkart", m.group(1), category, name, src, prices[0], mrp,
                         rating_of(rate.group(1)) if rate else None, link)
        if p:
            seen.add(m.group(1))
            out.append(p)
    return out


def fetch_flipkart(query: str, category: str) -> list[dict]:
    html = fetch(f"https://www.flipkart.com/search?q={quote(query)}&sort=popularity")
    return parse_flipkart(html, category) if html else []


# --------------------------------------------------------------------------- #
# Myntra  (JSON API first, embedded window.__myx as fallback)
# --------------------------------------------------------------------------- #
def myntra_items(products: Iterable[dict], category: str) -> list[dict]:
    out = []
    for it in products:
        pid = str(it.get("productId") or "")
        img = it.get("searchImage") or ""
        if not img and it.get("images"):
            img = it["images"][0].get("src", "")
        landing = it.get("landingPageUrl") or ""
        name = f'{it.get("brand", "")} {it.get("productName") or it.get("product") or ""}'.strip()
        rate = it.get("rating")
        p = make_product("myntra", pid, category, name, img,
                         money(it.get("price")), money(it.get("mrp")),
                         round(float(rate), 1) if rate else None,
                         f"https://www.myntra.com/{landing}" if landing else "")
        if p:
            out.append(p)
    return out


def fetch_myntra(query: str, category: str) -> list[dict]:
    slug = quote(query.replace(" ", "-"))
    api = (f"https://www.myntra.com/gateway/v2/search/{slug}"
           f"?rawQuery={quote(query)}&rows=50&o=0&p=1&sort=popularity")
    txt = fetch(api, extra_headers={"Accept": "application/json", "x-meta-app": "channel=web",
                                    "Referer": f"https://www.myntra.com/{slug}"})
    if txt:
        try:
            items = myntra_items(json.loads(txt).get("products", []), category)
            if items:
                return items
        except (json.JSONDecodeError, AttributeError):
            pass
    html = fetch(f"https://www.myntra.com/{slug}?sort=popularity")
    if html:
        m = re.search(r"window\.__myx\s*=\s*(\{.*?\})\s*</script>", html, re.S)
        if m:
            try:
                data = json.loads(m.group(1))
                return myntra_items(data["searchData"]["results"]["products"], category)
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
    return []


# --------------------------------------------------------------------------- #
# Meesho  (Next.js page: walk __NEXT_DATA__ for product-like objects)
# --------------------------------------------------------------------------- #
def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def parse_meesho(html: str, category: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    tag = soup.select_one("script#__NEXT_DATA__")
    if not tag or not tag.string:
        return []
    try:
        data = json.loads(tag.string)
    except json.JSONDecodeError:
        return []
    out, seen = [], set()
    for d in _walk(data):
        pid = d.get("product_id") or d.get("id")
        name = d.get("name") or d.get("title")
        price = money(d.get("min_product_price") or d.get("min_catalog_price") or d.get("price"))
        if not (pid and isinstance(name, str) and price) or pid in seen:
            continue
        imgs = d.get("product_images") or d.get("images") or []
        image = ""
        if imgs and isinstance(imgs[0], dict):
            image = imgs[0].get("url") or imgs[0].get("src") or ""
        elif imgs and isinstance(imgs[0], str):
            image = imgs[0]
        image = image or d.get("image") or ""
        mrp = money(d.get("original_price") or d.get("mrp") or d.get("min_product_original_price"))
        rating = None
        r = d.get("catalog_reviews_summary") or d.get("review_summary") or {}
        if isinstance(r, dict):
            rating = rating_of(r.get("average_rating") or r.get("rating_average"))
        slug = d.get("slug") or "product"
        p = make_product("meesho", str(pid), category, name, image, price, mrp, rating,
                         f"https://www.meesho.com/{slug}/p/{str(pid)}")
        if p:
            seen.add(pid)
            out.append(p)
    return out


def fetch_meesho(query: str, category: str) -> list[dict]:
    html = fetch(f"https://www.meesho.com/search?q={quote(query)}")
    return parse_meesho(html, category) if html else []


FETCHERS = {"amazon": fetch_amazon, "flipkart": fetch_flipkart,
            "myntra": fetch_myntra, "meesho": fetch_meesho}
STORES = list(FETCHERS)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def load_existing() -> dict[str, list[dict]]:
    try:
        data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        return {s: data.get(s, []) for s in STORES if isinstance(data.get(s), list)}
    except (OSError, json.JSONDecodeError):
        return {}


def main() -> int:
    old = load_existing()
    result: dict[str, list[dict]] = {s: [] for s in STORES}
    fresh_total = 0

    for category, queries in CATEGORIES:
        for store in STORES:
            query = queries.get(store)
            if not query:
                continue
            log(f"[{store}] {category!r} <- '{query}'")
            try:
                items = FETCHERS[store](query, category)
            except Exception as exc:             # noqa: BLE001 - one bad page must not stop the run
                log(f"    parser error: {exc!r}")
                items = []
            items = items[:PER_CATEGORY]
            if len(items) >= MIN_PER_CATEGORY:
                log(f"    ok: {len(items)} products")
                fresh_total += len(items)
            else:
                kept = [p for p in old.get(store, []) if p.get("category") == category]
                log(f"    only {len(items)} found - keeping {len(kept)} previous products")
                items = kept
            result[store].extend(items)
            pause()

    if fresh_total == 0:
        log("ERROR: nothing could be fetched from any store. products.json left untouched.")
        return 1

    # de-duplicate ids inside each store
    for store in STORES:
        seen, unique = set(), []
        for p in result[store]:
            if p["id"] not in seen:
                seen.add(p["id"])
                unique.append(p)
        result[store] = unique

    tmp = OUTPUT_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(OUTPUT_FILE)
    log(f"Saved {OUTPUT_FILE} - " + ", ".join(f"{s}: {len(v)}" for s, v in result.items()))
    return 0


if __name__ == "__main__":
    sys.exit(main())