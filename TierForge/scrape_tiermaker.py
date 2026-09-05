#!/usr/bin/env python3
"""
scrape_tiermaker.py - pull a TierMaker template or saved tier list into a
TierForge JSON pack (drag the .json onto tierforge.html, or use Import -> JSON pack).

    python scrape_tiermaker.py https://tiermaker.com/list/video-games/foo-123/456789
    python scrape_tiermaker.py https://tiermaker.com/create/foo-123 -o cards.json --embed

How it works
------------
A /create/ page ships an empty carousel and fills it from
`/api/?type=templates-v2&id=<template>&lastEdited=<ts>&variation=<n>`, which answers
`["template", {"src":..., "id":"1"}, ...]`. The page carries the `variation` and
`dateLastEdited` values needed for that call, so we read the page, then the API.
The endpoint 403s without a browser-ish User-Agent and a matching Referer.

A saved list's row assignments live in an inline `templateCode` string on the
/list/ page, where the numbers are those same item ids:

    template-name==Label|colourIndex|id|id|id==Label|colourIndex|id|...

If the API is ever unavailable we fall back to r.jina.ai's reader in raw-HTML mode,
which runs the page's JS and hands back the built DOM
(`<div id="N" class="character" style="background-image:url(...)">`).

Image files are served without any of that, so they download directly.

Stdlib only - no pip install needed.
"""
from __future__ import annotations

import argparse
import base64
import html as htmllib
import json
import mimetypes
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
TM_COLORS = ["#ff7f7f", "#ffbf7f", "#ffdf7f", "#ffff7f", "#bfff7f",
             "#7fff7f", "#7fffff", "#7fbfff", "#7f7fff", "#ff7fff"]


# --------------------------------------------------------------------------- net
def _get(url: str, headers: dict | None = None, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_page(url: str, verbose: bool = True) -> str:
    """Page HTML, direct first, then through the reader proxy."""
    attempts = [
        ("direct", url, None),
        ("r.jina.ai", "https://r.jina.ai/" + url, {"X-Return-Format": "html"}),
        ("allorigins", "https://api.allorigins.win/raw?url=" + urllib.parse.quote(url, ""), None),
    ]
    last = None
    for name, u, hdrs in attempts:
        try:
            if verbose:
                print(f"  [{name}] {url}", file=sys.stderr)
            body = _get(u, hdrs).decode("utf-8", "replace")
            if len(body) < 500:
                raise RuntimeError("empty response")
            if re.search(r"Just a moment|challenge-platform", body[:3000], re.I):
                raise RuntimeError("Cloudflare challenge")
            return body
        except Exception as e:  # noqa: BLE001
            last = e
            if verbose:
                print(f"      failed: {e}", file=sys.stderr)
            time.sleep(0.5)
    raise SystemExit(f"could not fetch {url}: {last}")


# ------------------------------------------------------------------------ parsing
CHAR_RE = re.compile(
    r'<div[^>]*\bid="(?P<id>[^"]+)"[^>]*\bclass="[^"]*\bcharacter\b[^"]*"[^>]*>(?P<rest>.{0,600}?)</div>',
    re.S)
BG_RE = re.compile(r'background-image:\s*url\((?:&quot;|["\'])?(.*?)(?:&quot;|["\'])?\)', re.I)
IMG_RE = re.compile(r'<img[^>]+(?:data-src|src)="([^"]+)"', re.I)
ALT_RE = re.compile(r'<img[^>]+alt="([^"]*)"', re.I)


def pretty(name: str) -> str:
    name = re.sub(r"\.[a-z0-9]+$", "", name, flags=re.I)
    name = re.sub(r"[_\-]+", " ", name)
    name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    return re.sub(r"\s+", " ", name).strip().title()


def parse_characters(page: str) -> list[dict]:
    """Every draggable tile on a /create/ page, in DOM order."""
    items, seen = [], set()
    # widen each match window so the inline <img> fallback is inside it
    for m in re.finditer(r'<div[^>]*\bclass="[^"]*\bcharacter\b[^"]*"[^>]*>', page):
        tag = m.group(0)
        chunk = page[m.start(): m.start() + 800]
        cid = (re.search(r'\bid="([^"]+)"', tag) or [None, None])[1]
        src = ""
        bg = BG_RE.search(htmllib.unescape(tag))
        if bg:
            src = bg.group(1)
        if not src:
            im = IMG_RE.search(chunk)
            src = im.group(1) if im else ""
        if not src or src.startswith("data:"):
            continue
        src = urllib.parse.urljoin("https://tiermaker.com/", htmllib.unescape(src))
        key = cid or str(len(items) + 1)
        if key in seen:
            continue
        seen.add(key)
        alt = ALT_RE.search(chunk)
        title = re.search(r'\btitle="([^"]*)"', tag)
        name = (title.group(1) if title else "") or (alt.group(1) if alt else "")
        name = htmllib.unescape(name).strip() or pretty(urllib.parse.unquote(src.rsplit("/", 1)[-1]))
        items.append({"key": key, "src": src, "name": name})
    return items


def fetch_template_items(template: str, verbose: bool = True) -> tuple[list[dict], str]:
    """(item tiles, page html) for a template - API first, DOM scrape as backup."""
    page = fetch_page("https://tiermaker.com/create/" + template, verbose)
    items = parse_api_items(page, template, verbose)
    if not items:
        if verbose:
            print("  API gave nothing - falling back to a DOM scrape", file=sys.stderr)
        items = parse_characters(page)
    if not items:
        page = _get("https://r.jina.ai/https://tiermaker.com/create/" + template,
                    {"X-Return-Format": "html"}).decode("utf-8", "replace")
        items = parse_characters(page)
    return items, page


def parse_api_items(page: str, template: str, verbose: bool = True) -> list[dict]:
    """Read the page's bootstrap values, then ask the templates-v2 endpoint."""
    var = re.search(r'initList\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"', page)
    edited = re.search(r'dateLastEdited\s*=\s*"([^"]*)"', page)
    base = re.search(r'baseTierImagePath\s*=\s*"([^"]*)"', page)
    qs = urllib.parse.urlencode({"type": "templates-v2", "id": template,
                                 "lastEdited": edited.group(1) if edited else "",
                                 "variation": var.group(1) if var else ""})
    try:
        raw = _get("https://tiermaker.com/api/?" + qs,
                   {"Accept": "*/*", "Referer": f"https://tiermaker.com/create/{template}"})
        data = json.loads(raw)
    except Exception as e:  # noqa: BLE001
        if verbose:
            print(f"  API failed: {e}", file=sys.stderr)
        return []
    if not isinstance(data, list):
        return []

    root = "https://tiermaker.com" + (base.group(1) if base else "")
    items = []
    for n, entry in enumerate(data[1:], 1):
        if isinstance(entry, dict):
            src, key = entry.get("src", ""), str(entry.get("id") or n)
        elif isinstance(entry, str):          # older shape: bare filenames
            src, key = root.rstrip("/") + "/" + entry, str(n)
        else:
            continue
        if not src:
            continue
        src = urllib.parse.urljoin("https://tiermaker.com/", src)
        items.append({"key": key, "src": src,
                      "name": pretty(urllib.parse.unquote(src.rsplit("/", 1)[-1]))})
    return items


def parse_template_code(page: str):
    m = re.search(r'templateCode\s*=\s*"([^"]+)"', page)
    if not m:
        return None
    parts = m.group(1).split("==")
    tiers = []
    for seg in filter(None, parts[1:]):
        f = seg.split("|")
        if len(f) < 2:
            continue
        try:
            cidx = int(f[1])
        except ValueError:
            cidx = len(tiers)
        tiers.append({"label": f[0], "color": TM_COLORS[cidx % 10],
                      "ids": [x for x in f[2:] if x]})
    return {"template": parts[0], "tiers": tiers}


def page_title(page: str) -> str:
    m = re.search(r"<title>([^<]*)</title>", page, re.I)
    t = htmllib.unescape(m.group(1)).strip() if m else ""
    t = re.sub(r"\s*[-–|]\s*TierMaker.*$", "", t, flags=re.I)
    return re.sub(r"^Create a\s+", "", t, flags=re.I).strip()


# ------------------------------------------------------------------------ images
def grab_images(items, mode: str, outdir: str):
    """mode: 'link' (leave URLs), 'embed' (base64 into the json), 'files' (save next to it)"""
    if mode == "link":
        return
    if mode == "files":
        os.makedirs(outdir, exist_ok=True)
    for n, it in enumerate(items, 1):
        print(f"  image {n}/{len(items)}  {it['name']}", file=sys.stderr)
        try:
            blob = _get(it["src"], timeout=45)
        except Exception as e:  # noqa: BLE001
            print(f"      skipped: {e}", file=sys.stderr)
            continue
        ext = os.path.splitext(urllib.parse.urlparse(it["src"]).path)[1] or ".png"
        if mode == "embed":
            mime = mimetypes.types_map.get(ext.lower(), "image/png")
            it["img"] = f"data:{mime};base64," + base64.b64encode(blob).decode()
        else:
            fn = re.sub(r"[^A-Za-z0-9._-]", "_", f"{it['key']}_{it['name']}")[:60] + ext
            with open(os.path.join(outdir, fn), "wb") as fh:
                fh.write(blob)
            it["img"] = os.path.basename(outdir) + "/" + fn


# ------------------------------------------------------------------------- build
def build_pack(url: str, verbose: bool = True) -> dict:
    """Everything a TierForge board needs, straight from a TierMaker link."""
    url = url.split("#")[0].replace("http://", "https://")
    tc, title = None, ""

    if "/list/" in url:
        if verbose:
            print("Reading list page...", file=sys.stderr)
        page = fetch_page(url, verbose)
        tc = parse_template_code(page)
        title = page_title(page)
        template = tc["template"] if tc else ""
        if not template:
            m = re.search(r"/list/[^/]+/([^/?]+)", url)
            template = m.group(1) if m else ""
        if not tc and verbose:
            print("  ! no templateCode - importing the empty template", file=sys.stderr)
    elif "/create/" in url:
        m = re.search(r"/create/([^/?]+)", url)
        template = m.group(1) if m else ""
    else:
        raise ValueError("expected a tiermaker.com /list/ or /create/ URL")
    if not template:
        raise ValueError("could not determine the template name from that URL")

    if verbose:
        print(f"Template: {template}", file=sys.stderr)
        print("Reading template...", file=sys.stderr)
    chars, tpl = fetch_template_items(template, verbose)
    if not chars:
        raise ValueError("no items found - TierMaker may have changed its API")
    if verbose:
        print(f"Found {len(chars)} items", file=sys.stderr)

    for c in chars:
        c["img"] = c["src"]
    return {"v": 1, "title": title or page_title(tpl) or template, "source": url,
            "template": template, "chars": chars, "tc": tc}


def finish_pack(raw: dict, tags: list[str] | None = None) -> dict:
    """Turn build_pack() output into the board JSON the app loads."""
    chars, tc = raw["chars"], raw["tc"]
    tags = list(tags or [])
    items = [{"id": c["key"], "key": c["key"], "tmkey": c["key"], "name": c["name"],
              "tags": list(tags), "notes": "", "img": c["img"], "src": c["src"]}
             for c in chars]
    known = {c["key"] for c in chars}
    if tc and tc["tiers"]:
        tiers = [{"label": t["label"], "color": t["color"],
                  "items": [i for i in t["ids"] if i in known]} for t in tc["tiers"]]
    else:
        tiers = [{"label": l, "color": c, "items": []} for l, c in zip("SABCDF", TM_COLORS)]
    placed = {i for t in tiers for i in t["items"]}
    return {"v": 1, "title": raw["title"], "source": raw["source"], "tiers": tiers,
            "pool": [c["key"] for c in chars if c["key"] not in placed], "items": items}


# -------------------------------------------------------------------------- serve
HELPER_HELP = """TierForge helper is running.

  open        http://127.0.0.1:{port}/tierforge.html
  import API  /import?url=<tiermaker url>[&embed=1][&tags=a,b]

The app calls that endpoint itself, so pasting a link into Import -> TierMaker URL
just works - no CORS proxy, no Cloudflare, no bookmarklet."""


def serve(port: int, open_browser: bool = True) -> int:
    import http.server
    import threading
    import webbrowser

    root = os.path.dirname(os.path.abspath(__file__))

    class Handler(http.server.SimpleHTTPRequestHandler):
        # Windows' registry can claim .html is video/html, which makes browsers
        # download the app instead of running it.
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          ".html": "text/html", ".js": "text/javascript",
                          ".json": "application/json", ".css": "text/css"}

        def __init__(self, *a, **kw):
            super().__init__(*a, directory=root, **kw)

        def log_message(self, fmt, *a):  # one tidy line per request
            print(f"  {self.address_string()} {fmt % a}", file=sys.stderr)

        def _send(self, code, body: bytes, ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.end_headers()

        def do_GET(self):
            parts = urllib.parse.urlsplit(self.path)
            if parts.path.rstrip("/") not in ("/import", "/api/import"):
                return super().do_GET()
            qs = urllib.parse.parse_qs(parts.query)
            url = (qs.get("url") or [""])[0]
            if not url:   # the app's presence probe - 200 so it doesn't log an error
                return self._send(200, b'{"helper":"tierforge","import":"/import?url="}')
            try:
                print(f"Import: {url}", file=sys.stderr)
                raw = build_pack(url)
                tags = [t.strip() for t in (qs.get("tags") or [""])[0].split(",") if t.strip()]
                if (qs.get("embed") or [""])[0] in ("1", "true", "yes"):
                    grab_images(raw["chars"], "embed", "")
                pack = finish_pack(raw, tags)
                print(f"  -> {len(pack['items'])} items, {len(pack['tiers'])} tiers",
                      file=sys.stderr)
                self._send(200, json.dumps(pack, ensure_ascii=False).encode("utf-8"))
            except Exception as e:  # noqa: BLE001
                print(f"  !! {e}", file=sys.stderr)
                self._send(502, json.dumps({"error": str(e)}).encode("utf-8"))

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/tierforge.html"
    print(HELPER_HELP.format(port=port), file=sys.stderr)
    print(f"{chr(10)}Ctrl+C to stop.{chr(10)}", file=sys.stderr)
    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print(f"{chr(10)}stopped", file=sys.stderr)
    return 0


# -------------------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url", nargs="?", help="tiermaker.com /list/... or /create/... URL")
    ap.add_argument("--serve", action="store_true",
                    help="run the local helper: serves the app and does imports for it")
    ap.add_argument("--port", type=int, default=8777, help="helper port (default 8777)")
    ap.add_argument("--no-browser", action="store_true", help="--serve without opening a browser")
    ap.add_argument("-o", "--out", help="output .json (default: <template>.tierforge.json)")
    ap.add_argument("--embed", action="store_true", help="base64 every image into the JSON")
    ap.add_argument("--images", metavar="DIR", help="download images into DIR and link relatively")
    ap.add_argument("--tags", default="", help="comma-separated tags applied to every item")
    args = ap.parse_args()

    if args.serve:
        return serve(args.port, not args.no_browser)
    if not args.url:
        ap.error("give a tiermaker URL, or --serve to run the local helper")

    raw = build_pack(args.url)
    template, chars, title = raw["template"], raw["chars"], raw["title"]

    out = args.out or f"{template}.tierforge.json"
    mode = "embed" if args.embed else ("files" if args.images else "link")
    imgdir = args.images or os.path.splitext(out)[0] + "_images"
    for c in chars:
        c["img"] = c["src"]
    grab_images(chars, mode, imgdir)

    pack = finish_pack(raw, [t.strip() for t in args.tags.split(",") if t.strip()])
    placed = {i for t in pack["tiers"] for i in t["items"]}
    items, tiers, pool = pack["items"], pack["tiers"], pack["pool"]

    with open(out, "w", encoding="utf-8") as fh:
        json.dump(pack, fh, ensure_ascii=False, indent=1)

    print(f"\nWrote {out}", file=sys.stderr)
    print(f"  {len(items)} items, {len(tiers)} tiers, {len(placed)} ranked, {len(pool)} unranked",
          file=sys.stderr)
    if mode == "files":
        print(f"  images in {imgdir}/", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
