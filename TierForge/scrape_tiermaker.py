#!/usr/bin/env python3
"""
scrape_tiermaker.py - the TierForge local helper: pulls a TierMaker template or
saved tier list, or the Slay the Spire 2 wiki's card list, into a TierForge JSON
pack; and (via --serve) serves the app plus a small API for imports and for
saving boards to disk instead of the browser's localStorage.

    python scrape_tiermaker.py https://tiermaker.com/list/video-games/foo-123/456789
    python scrape_tiermaker.py https://tiermaker.com/create/foo-123 -o cards.json --embed
    python scrape_tiermaker.py https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:Cards_List

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

The Slay the Spire 2 wiki's Cards List page is plain server-rendered HTML (no JS
wall) - every card sits in a `<div class="card-box" data-name=... data-rarity=...
data-color=... data-type=... data-tags=...>`, so it's read straight off the page
with no separate API call. Neither site sends CORS headers, so a browser can't
fetch either one on its own - hence this helper.

Image files are served without any of that, so they download directly.

--serve also exposes /boards, an on-disk replacement for TierForge's board
storage: GET lists saved boards, GET/PUT/DELETE /boards/<name> reads, writes or
removes Saved/<name>.tierforge.json next to this script.

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
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
TM_COLORS = ["#ff7f7f", "#ffbf7f", "#ffdf7f", "#ffff7f", "#bfff7f",
             "#7fff7f", "#7fffff", "#7fbfff", "#7f7fff", "#ff7fff"]

# Every fetch_page()/grab_images() progress line already goes to stderr for the
# CLI. --serve's /import/start also runs each import on its own thread and
# wants those same lines relayed to the browser (import can take ~40s pulling
# ~600 images), so _log() additionally calls whatever callback that thread has
# registered on this thread-local - the request-handling threads never set one,
# so a plain synchronous /import stays silent exactly as before.
_tls = threading.local()


def _log(msg: str) -> None:
    print(msg, file=sys.stderr)
    cb = getattr(_tls, "cb", None)
    if cb:
        cb(msg)


# --------------------------------------------------------------------------- net
def _get_via_curl(url: str, headers: dict | None = None, timeout: int = 90) -> bytes:
    """Some Cloudflare-fronted sites 403 Python's TLS fingerprint but let curl
    through with identical headers - shell out to the system curl as a fallback."""
    cmd = ["curl", "-sS", "-L", "--max-time", str(timeout), "-A", UA]
    for k, v in (headers or {}).items():
        cmd += ["-H", f"{k}: {v}"]
    cmd.append(url)
    try:
        out = subprocess.run(cmd, capture_output=True, timeout=timeout + 10)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise urllib.error.URLError(f"curl fallback unavailable: {e}") from e
    if out.returncode != 0:
        raise urllib.error.URLError(
            f"curl exited {out.returncode}: {out.stderr.decode('utf-8', 'replace')[:200]}")
    return out.stdout


def _get(url: str, headers: dict | None = None, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise
        return _get_via_curl(url, headers, timeout)


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
                _log(f"  [{name}] {url}")
            body = _get(u, hdrs).decode("utf-8", "replace")
            if len(body) < 500:
                raise RuntimeError("empty response")
            if re.search(r"Just a moment|challenge-platform", body[:3000], re.I):
                raise RuntimeError("Cloudflare challenge")
            return body
        except Exception as e:  # noqa: BLE001
            last = e
            if verbose:
                _log(f"      failed: {e}")
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
            _log("  API gave nothing - falling back to a DOM scrape")
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
            _log(f"  API failed: {e}")
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


# --------------------------------------------------------------- STS2 wiki
def original_wiki_image_url(src: str) -> str:
    """Convert a MediaWiki thumbnail URL to the underlying original image.

    The wiki serves card art through URLs such as
    ``/images/thumb/Card.png/150px-Card.png``.  The final thumbnail-size
    component can be removed to address the original at ``/images/Card.png``.
    Other hosts and non-thumbnail URLs are returned unchanged.
    """
    parsed = urllib.parse.urlsplit(src)
    if parsed.netloc.lower() not in {"slaythespire.wiki.gg", "www.slaythespire.wiki.gg"}:
        return src
    marker = "/images/thumb/"
    if marker not in parsed.path:
        return src

    prefix, thumb_path = parsed.path.split(marker, 1)
    parts = thumb_path.strip("/").split("/")
    if len(parts) < 2 or not re.match(r"^\d+px-", parts[-1], re.I):
        return src

    filename = re.sub(r"^\d+px-", "", parts[-1], flags=re.I)
    if not filename:
        return src
    original_path = prefix + "/images/" + "/".join(parts[:-2] + [filename])
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, original_path,
                                    parsed.query, parsed.fragment))


def parse_stswiki_cards(page: str) -> list[dict]:
    """Every `.card-box` on a slaythespire.wiki.gg Cards List page."""
    items, seen = [], set()
    for m in re.finditer(r'<div class="card-box"([^>]*)>', page):
        attrs = dict(re.findall(r'data-([a-z]+)="([^"]*)"', m.group(1)))
        name = htmllib.unescape(attrs.get("name", "")).strip()
        if not name:
            continue
        window = page[m.end(): m.end() + 4000]
        nxt = window.find('<div class="card-box"')
        if nxt != -1:
            window = window[:nxt]
        imgm = re.search(r'class="img-base".*?<img[^>]+src="([^"]+)"', window, re.S)
        if not imgm:
            continue
        src = urllib.parse.urljoin("https://slaythespire.wiki.gg/", htmllib.unescape(imgm.group(1)))
        src = original_wiki_image_url(src)

        tags = [attrs.get(k, "") for k in ("color", "rarity", "type")]
        tags += [t.strip() for t in attrs.get("tags", "").split(",")]
        tags = list(dict.fromkeys(t for t in tags if t))

        note = ""
        descm = re.search(r'class="desc-base">(.*?)</div>', window, re.S)
        if descm:
            note = htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", descm.group(1)))).strip()
        cost = attrs.get("cost", "")
        if cost:
            note = f"Cost {cost}. {note}".strip()

        key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or str(len(items) + 1)
        if key in seen:
            key = f"{key}-{len(items) + 1}"
        seen.add(key)
        items.append({"key": key, "src": src, "name": name, "tags": tags, "notes": note})
    return items


def stswiki_title(page: str) -> str:
    m = re.search(r"<title>([^<]*)</title>", page, re.I)
    t = htmllib.unescape(m.group(1)).strip() if m else ""
    return re.sub(r"\s*[|–-]\s*Slay the Spire 2.*$", "", t, flags=re.I).strip()


def build_stswiki_pack(url: str, verbose: bool = True, embed: bool = False) -> dict:
    """A ready-to-load TierForge board straight from the wiki's Cards List page."""
    if verbose:
        _log("Reading wiki page...")
    page = fetch_page(url, verbose)
    cards = parse_stswiki_cards(page)
    if not cards:
        raise ValueError("no cards found on that page - the wiki layout may have changed")
    if verbose:
        _log(f"Found {len(cards)} cards")
    for c in cards:
        c["img"] = c["src"]
    if embed:
        grab_images(cards, "embed", "")
    title = stswiki_title(page) or "Slay the Spire 2 Cards"
    tiers = [{"label": l, "color": c, "items": []} for l, c in zip("SABCDF", TM_COLORS)]
    items = [{"id": c["key"], "key": c["key"], "name": c["name"], "tags": c["tags"],
              "notes": c["notes"], "img": c["img"], "src": c["src"]} for c in cards]
    return {"v": 1, "title": title, "source": url, "tiers": tiers,
            "pool": [c["key"] for c in cards], "items": items}


# ------------------------------------------------------------------------ images
def grab_images(items, mode: str, outdir: str, verbose: bool = True):
    """mode: 'link' (leave URLs), 'embed' (base64 into the json), 'files' (save next to it)"""
    if mode == "link":
        return
    if mode == "files":
        os.makedirs(outdir, exist_ok=True)
    for n, it in enumerate(items, 1):
        if verbose:
            _log(f"  image {n}/{len(items)}  {it['name']}")
        try:
            blob = _get(it["src"], timeout=45)
        except Exception as e:  # noqa: BLE001
            if verbose:
                _log(f"      skipped: {e}")
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
            _log("Reading list page...")
        page = fetch_page(url, verbose)
        tc = parse_template_code(page)
        title = page_title(page)
        template = tc["template"] if tc else ""
        if not template:
            m = re.search(r"/list/[^/]+/([^/?]+)", url)
            template = m.group(1) if m else ""
        if not tc and verbose:
            _log("  ! no templateCode - importing the empty template")
    elif "/create/" in url:
        m = re.search(r"/create/([^/?]+)", url)
        template = m.group(1) if m else ""
    else:
        raise ValueError("expected a tiermaker.com /list/ or /create/ URL")
    if not template:
        raise ValueError("could not determine the template name from that URL")

    if verbose:
        _log(f"Template: {template}")
        _log("Reading template...")
    chars, tpl = fetch_template_items(template, verbose)
    if not chars:
        raise ValueError("no items found - TierMaker may have changed its API")
    if verbose:
        _log(f"Found {len(chars)} items")

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


def _do_import(url: str, embed: bool, tags: list[str]) -> dict:
    """The one place that decides which scraper a URL needs. Shared by the
    plain synchronous /import and the backgrounded /import/start job."""
    if "slaythespire.wiki.gg" in url.lower():
        return build_stswiki_pack(url, embed=embed)
    raw = build_pack(url)
    if embed:
        grab_images(raw["chars"], "embed", "")
    return finish_pack(raw, tags)


# -------------------------------------------------------------------- import jobs
# /import runs synchronously - fine for a small TierMaker template, but pulling
# ~600 embedded wiki images takes tens of seconds with nothing to show for it
# in the meantime. /import/start instead runs the same work on a background
# thread and returns a job id right away; /import/poll hands back whatever new
# progress lines _log() has collected since the caller's last poll, so the
# browser can stream them into its own log panel while the fetch is still
# running, then pick up the finished pack (or error) once done:true.
_JOBS: dict[str, dict] = {}
_JOBS_LOCK = threading.Lock()


def _job_append(job_id: str, msg: str) -> None:
    with _JOBS_LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job["lines"].append(msg)


def _run_import_job(job_id: str, url: str, embed: bool, tags: list[str]) -> None:
    _tls.cb = lambda m: _job_append(job_id, m)
    try:
        pack = _do_import(url, embed, tags)
        with _JOBS_LOCK:
            _JOBS[job_id]["result"] = pack
            _JOBS[job_id]["done"] = True
    except Exception as e:  # noqa: BLE001
        with _JOBS_LOCK:
            _JOBS[job_id]["error"] = str(e)
            _JOBS[job_id]["done"] = True
    finally:
        _tls.cb = None


# -------------------------------------------------------------------------- serve
HELPER_HELP = """TierForge helper is running.

  open        http://127.0.0.1:{port}/tierforge.html
  import API  /import?url=<tiermaker or slaythespire.wiki.gg url>[&embed=1][&tags=a,b]
  import job  /import/start?url=...  ->  {{"job":id}}   /import/poll?job=id&since=n
  boards API  /boards  (list)   /boards/<name>  (GET/PUT/DELETE, on disk in Saved/)

The app calls these itself, so pasting a link into Import -> URL just works, and
Boards are saved to this folder's Saved/ directory instead of the browser."""

BOARD_EXT = ".tierforge.json"


def safe_board_name(raw: str) -> str | None:
    name = re.sub(r"[^A-Za-z0-9 _\-]+", "_", urllib.parse.unquote(raw)).strip()[:80]
    return name or None


def serve(port: int, open_browser: bool = True) -> int:
    import http.server
    import threading
    import webbrowser

    root = os.path.dirname(os.path.abspath(__file__))
    saved_dir = os.path.join(root, "Saved")

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

        def _err(self, code, msg):
            self._send(code, json.dumps({"error": msg}).encode("utf-8"))

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, PUT, DELETE, OPTIONS")
            self.end_headers()

        def do_GET(self):
            parts = urllib.parse.urlsplit(self.path)
            p = parts.path.rstrip("/")
            if p == "/boards":
                return self._list_boards()
            if p.startswith("/boards/"):
                return self._get_board(p[len("/boards/"):])
            if p == "/import/start":
                return self._import_start(parts.query)
            if p == "/import/poll":
                return self._import_poll(parts.query)
            if p not in ("/import", "/api/import"):
                return super().do_GET()
            qs = urllib.parse.parse_qs(parts.query)
            url = (qs.get("url") or [""])[0]
            if not url:   # the app's presence probe - 200 so it doesn't log an error
                return self._send(200, b'{"helper":"tierforge","import":"/import?url="}')
            try:
                _log(f"Import: {url}")
                embed = (qs.get("embed") or [""])[0] in ("1", "true", "yes")
                tags = [t.strip() for t in (qs.get("tags") or [""])[0].split(",") if t.strip()]
                pack = _do_import(url, embed, tags)
                _log(f"  -> {len(pack['items'])} items, {len(pack['tiers'])} tiers")
                self._send(200, json.dumps(pack, ensure_ascii=False).encode("utf-8"))
            except Exception as e:  # noqa: BLE001
                _log(f"  !! {e}")
                self._send(502, json.dumps({"error": str(e)}).encode("utf-8"))

        def _import_start(self, query):
            qs = urllib.parse.parse_qs(query)
            url = (qs.get("url") or [""])[0]
            if not url:
                return self._err(400, "missing url")
            embed = (qs.get("embed") or [""])[0] in ("1", "true", "yes")
            tags = [t.strip() for t in (qs.get("tags") or [""])[0].split(",") if t.strip()]
            job_id = uuid.uuid4().hex[:12]
            with _JOBS_LOCK:
                _JOBS[job_id] = {"lines": [f"Import: {url}"], "done": False,
                                  "result": None, "error": None}
            threading.Thread(target=_run_import_job, args=(job_id, url, embed, tags),
                              daemon=True).start()
            self._send(200, json.dumps({"job": job_id}).encode("utf-8"))

        def _import_poll(self, query):
            qs = urllib.parse.parse_qs(query)
            job_id = (qs.get("job") or [""])[0]
            since = int((qs.get("since") or ["0"])[0] or 0)
            with _JOBS_LOCK:
                job = _JOBS.get(job_id)
                if job is None:
                    return self._err(404, "unknown job")
                payload = {"lines": job["lines"][since:], "total": len(job["lines"]),
                           "done": job["done"]}
                if job["done"]:
                    if job["error"] is not None:
                        payload["error"] = job["error"]
                    else:
                        payload["result"] = job["result"]
            if job["done"]:
                with _JOBS_LOCK:
                    _JOBS.pop(job_id, None)
            self._send(200, json.dumps(payload, ensure_ascii=False).encode("utf-8"))

        def do_PUT(self):
            p = urllib.parse.urlsplit(self.path).path.rstrip("/")
            if p.startswith("/boards/"):
                return self._put_board(p[len("/boards/"):])
            self._err(404, "not found")

        def do_DELETE(self):
            p = urllib.parse.urlsplit(self.path).path.rstrip("/")
            if p.startswith("/boards/"):
                return self._delete_board(p[len("/boards/"):])
            self._err(404, "not found")

        # ---- boards: one Saved/<name>.tierforge.json file per board ----
        def _list_boards(self):
            os.makedirs(saved_dir, exist_ok=True)
            out = []
            for fn in os.listdir(saved_dir):
                if not fn.endswith(BOARD_EXT):
                    continue
                name = fn[:-len(BOARD_EXT)]
                if name.startswith("_"):   # reserved for autosave
                    continue
                try:
                    st = os.stat(os.path.join(saved_dir, fn))
                except OSError:
                    continue
                out.append({"name": name, "mtime": int(st.st_mtime * 1000)})
            out.sort(key=lambda b: b["name"].lower())
            self._send(200, json.dumps({"boards": out}).encode("utf-8"))

        def _get_board(self, raw_name):
            name = safe_board_name(raw_name)
            if not name:
                return self._err(400, "bad board name")
            fp = os.path.join(saved_dir, name + BOARD_EXT)
            if not os.path.isfile(fp):
                return self._err(404, "not found")
            with open(fp, "rb") as fh:
                self._send(200, fh.read())

        def _put_board(self, raw_name):
            name = safe_board_name(raw_name)
            if not name:
                return self._err(400, "bad board name")
            length = int(self.headers.get("Content-Length", 0) or 0)
            body = self.rfile.read(length) if length else b""
            try:
                json.loads(body)
            except Exception as e:  # noqa: BLE001
                return self._err(400, f"invalid JSON: {e}")
            os.makedirs(saved_dir, exist_ok=True)
            with open(os.path.join(saved_dir, name + BOARD_EXT), "wb") as fh:
                fh.write(body)
            self._send(200, b'{"ok":true}')

        def _delete_board(self, raw_name):
            name = safe_board_name(raw_name)
            if not name:
                return self._err(400, "bad board name")
            try:
                os.remove(os.path.join(saved_dir, name + BOARD_EXT))
            except FileNotFoundError:
                pass
            except OSError as e:
                return self._err(500, str(e))
            self._send(200, b'{"ok":true}')

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
    ap.add_argument("url", nargs="?",
                    help="tiermaker.com /list/... or /create/... URL, or a slaythespire.wiki.gg Cards List URL")
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
        ap.error("give a tiermaker or slaythespire.wiki.gg URL, or --serve to run the local helper")

    if "slaythespire.wiki.gg" in args.url.lower():
        pack = build_stswiki_pack(args.url, embed=args.embed)
        out = args.out or "sts2-cards.tierforge.json"
        if args.images and not args.embed:
            items = [{"key": it["id"], "src": it["src"]} for it in pack["items"]]
            grab_images(items, "files", args.images)
            by_key = {it["key"]: it for it in items}
            for it in pack["items"]:
                it["img"] = by_key[it["id"]]["img"]
    else:
        raw = build_pack(args.url)
        template, chars = raw["template"], raw["chars"]
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
