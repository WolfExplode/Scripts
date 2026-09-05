import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access as fileExists, mkdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const TM_COLORS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f',
  '#7fff7f', '#7fffff', '#7fbfff', '#7f7fff', '#ff7fff'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const canonicalHeader = name => name.split('-').map(part => part[0].toUpperCase() + part.slice(1)).join('-');

function decodeHtml(value = '') {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? all;
    const radix = code[1]?.toLowerCase() === 'x' ? 16 : 10;
    const number = parseInt(code.slice(radix === 16 ? 2 : 1), radix);
    return Number.isFinite(number) ? String.fromCodePoint(number) : all;
  });
}

async function curl(url, headers, timeoutMs) {
  const args = ['-sS', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA];
  for (const [name, value] of Object.entries(headers)) args.push('-H', `${canonicalHeader(name)}: ${value}`);
  args.push(url);
  try {
    const { stdout } = await execFileAsync('curl', args, {
      encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, timeout: timeoutMs + 10_000,
    });
    return Buffer.from(stdout);
  } catch (error) {
    throw new Error(`curl fallback failed: ${error.message}`);
  }
}

async function tierMakerApiThroughCurlSession(template, endpoint, headers) {
  const cookieFile = path.join(tmpdir(), `tierforge-${randomUUID()}.cookies`);
  const common = ['-sS', '-L', '--max-time', '90', '-A', UA, '-c', cookieFile, '-b', cookieFile];
  try {
    await execFileAsync('curl', [...common, `https://tiermaker.com/create/${template}`], {
      encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, timeout: 100_000,
    });
    const headerArgs = Object.entries(headers)
      .flatMap(([name, value]) => ['-H', `${canonicalHeader(name)}: ${value}`]);
    const { stdout } = await execFileAsync('curl', [...common, ...headerArgs, endpoint], {
      encoding: 'buffer', maxBuffer: 100 * 1024 * 1024, timeout: 100_000,
    });
    return Buffer.from(stdout);
  } finally {
    await unlink(cookieFile).catch(() => {});
  }
}

export async function requestBytes(url, { headers = {}, timeoutMs = 90_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: 'follow', signal: controller.signal, headers: { 'user-agent': UA, ...headers },
    });
    if (response.status === 403) return curl(url, headers, timeoutMs);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(url, log) {
  const attempts = [
    ['direct', url, {}],
    ['r.jina.ai', `https://r.jina.ai/${url}`, { 'x-return-format': 'html' }],
    ['allorigins', `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {}],
  ];
  let lastError;
  for (const [name, target, headers] of attempts) {
    try {
      log(`  [${name}] ${url}`);
      const body = (await requestBytes(target, { headers })).toString('utf8');
      if (body.length < 500) throw new Error('empty response');
      if (/Just a moment|challenge-platform/i.test(body.slice(0, 3000))) {
        throw new Error('Cloudflare challenge');
      }
      return body;
    } catch (error) {
      lastError = error;
      log(`      failed: ${error.message}`);
      await sleep(300);
    }
  }
  throw new Error(`could not fetch ${url}: ${lastError?.message ?? 'unknown error'}`);
}

export function prettyName(name = '') {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
    .replace(/(?<=[a-z])(?=[A-Z])/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function parseCharacters(page) {
  const items = [];
  const seen = new Set();
  const matcher = /<div[^>]*\bclass="[^"]*\bcharacter\b[^"]*"[^>]*>/gi;
  for (const match of page.matchAll(matcher)) {
    const tag = match[0];
    const chunk = page.slice(match.index, match.index + 800);
    const id = /\bid="([^"]+)"/i.exec(tag)?.[1];
    let src = /background-image:\s*url\((?:&quot;|["'])?(.*?)(?:&quot;|["'])?\)/i
      .exec(decodeHtml(tag))?.[1];
    src ||= /<img[^>]+(?:data-src|src)="([^"]+)"/i.exec(chunk)?.[1];
    if (!src || src.startsWith('data:')) continue;
    src = new URL(decodeHtml(src), 'https://tiermaker.com/').href;
    const key = id || String(items.length + 1);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = /\btitle="([^"]*)"/i.exec(tag)?.[1];
    const alt = /<img[^>]+alt="([^"]*)"/i.exec(chunk)?.[1];
    const fallback = decodeURIComponent(new URL(src).pathname.split('/').pop());
    items.push({ key, src, name: decodeHtml(title || alt || '').trim() || prettyName(fallback) });
  }
  return items;
}

export function parseTemplateCode(page) {
  const code = /templateCode\s*=\s*"([^"]+)"/.exec(page)?.[1];
  if (!code) return null;
  const [template, ...segments] = code.split('==');
  const tiers = segments.filter(Boolean).map((segment, index) => {
    const [label, rawColor, ...ids] = segment.split('|');
    const colorIndex = Number.isFinite(Number(rawColor)) ? Number(rawColor) : index;
    return { label, color: TM_COLORS[colorIndex % TM_COLORS.length], ids: ids.filter(Boolean) };
  });
  return { template, tiers };
}

function pageTitle(page) {
  return decodeHtml(/<title>([^<]*)<\/title>/i.exec(page)?.[1] || '').trim()
    .replace(/\s*[-–|]\s*TierMaker.*$/i, '').replace(/^Create a\s+/i, '').trim();
}

async function parseApiItems(page, template, log) {
  const variation = /initList\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"([^"]*)"/.exec(page)?.[1] || '';
  const lastEdited = /dateLastEdited\s*=\s*"([^"]*)"/.exec(page)?.[1] || '';
  const base = /baseTierImagePath\s*=\s*"([^"]*)"/.exec(page)?.[1] || '';
  const query = new URLSearchParams({ type: 'templates-v2', id: template, lastEdited, variation });
  const endpoint = `https://tiermaker.com/api/?${query}`;
  const headers = { accept: '*/*', referer: `https://tiermaker.com/create/${template}` };
  let data;
  try {
    data = JSON.parse((await requestBytes(endpoint, { headers })).toString('utf8'));
  } catch (directError) {
    // TierMaker sometimes returns a 200 HTML challenge to Node instead of a
    // 403. curl has a different TLS fingerprint and remains a useful adapter.
    try {
      log(`  direct API failed (${directError.message}); retrying through curl`);
      data = JSON.parse((await tierMakerApiThroughCurlSession(template, endpoint, headers)).toString('utf8'));
    } catch (curlError) {
      log(`  API failed: ${curlError.message}`);
      return [];
    }
  }
  if (!Array.isArray(data)) return [];
  const root = `https://tiermaker.com${base}`.replace(/\/$/, '');
  return data.slice(1).flatMap((entry, index) => {
    const key = String(typeof entry === 'object' ? entry?.id || index + 1 : index + 1);
    const raw = typeof entry === 'object' ? entry?.src : typeof entry === 'string' ? `${root}/${entry}` : '';
    if (!raw) return [];
    const src = new URL(raw, 'https://tiermaker.com/').href;
    return [{ key, src, name: prettyName(decodeURIComponent(new URL(src).pathname.split('/').pop())) }];
  });
}

async function fetchTemplateItems(template, log) {
  let page = await fetchPage(`https://tiermaker.com/create/${template}`, log);
  let items = await parseApiItems(page, template, log);
  if (!items.length) {
    log('  API gave nothing - falling back to a DOM scrape');
    items = parseCharacters(page);
  }
  if (!items.length) {
    page = (await requestBytes(`https://r.jina.ai/https://tiermaker.com/create/${template}`,
      { headers: { 'x-return-format': 'html' } })).toString('utf8');
    items = parseCharacters(page);
  }
  return { items, page };
}

export function originalWikiImageUrl(src) {
  const url = new URL(src);
  if (!['slaythespire.wiki.gg', 'www.slaythespire.wiki.gg'].includes(url.hostname.toLowerCase())) return src;
  const marker = '/images/thumb/';
  if (!url.pathname.includes(marker)) return src;
  const [prefix, rest] = url.pathname.split(marker);
  const parts = rest.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2 || !/^\d+px-/i.test(parts.at(-1))) return src;
  const filename = parts.at(-1).replace(/^\d+px-/i, '');
  url.pathname = `${prefix}/images/${[...parts.slice(0, -2), filename].join('/')}`;
  return url.href;
}

export function parseWikiCards(page) {
  return parseWikiItems(page, 'card');
}

/** Parse either of the STS2 compendium list layouts. Cards and relics share
 * their data attributes and image markup, while their description wrappers
 * differ slightly. */
export function parseWikiItems(page, type) {
  const boxClass = type === 'relic' ? 'relic-box' : 'card-box';
  const cards = [];
  const seen = new Set();
  const matcher = new RegExp(`<div\\s+class="${boxClass}"([^>]*)>`, 'gi');
  const matches = [...page.matchAll(matcher)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const attrs = Object.fromEntries([...match[1].matchAll(/data-([a-z-]+)="([^"]*)"/gi)]
      .map(value => [value[1].toLowerCase(), decodeHtml(value[2])]));
    const name = (attrs.name || '').trim();
    if (!name) continue;
    const end = matches[index + 1]?.index ?? match.index + 4000;
    const window = page.slice(match.index + match[0].length, Math.min(end, match.index + 4000));
    const image = /class="img-base".*?<img[^>]+src="([^"]+)"/is.exec(window)?.[1];
    if (!image) continue;
    const src = originalWikiImageUrl(new URL(decodeHtml(image), 'https://slaythespire.wiki.gg/').href);
    const tags = [...new Set([
      attrs.color, attrs.rarity, attrs.type, attrs.character, attrs['ancient-upgrade'] === 'Yes' ? 'Ancient' : '',
      ...(attrs.tags || '').split(',').map(tag => tag.trim()),
    ].filter(Boolean))];
    const descriptionClass = type === 'relic' ? 'relic-desc' : 'desc-base';
    let notes = decodeHtml((new RegExp(`class="${descriptionClass}">(.*?)<\\/div>`, 'is').exec(window)?.[1] || '')
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
    if (attrs.cost) notes = `Cost ${attrs.cost}. ${notes}`.trim();
    let key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || String(cards.length + 1);
    if (seen.has(key)) key = `${key}-${cards.length + 1}`;
    seen.add(key);
    cards.push({ key, src, img: src, name, tags, notes });
  }
  return cards;
}

export function parseWikiRelics(page) {
  return parseWikiItems(page, 'relic');
}

const normalizedItemName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** TierMaker occasionally exposes a wiki image filename instead of its title
 * (for example "80px StS2ArcaneScroll"). Keep matching name-based, but remove
 * those predictable filename prefixes so targeted wiki relinking still works. */
function itemNameKeys(value) {
  const normalized = normalizedItemName(value);
  const keys = new Set([normalized]);
  let loose = normalized.replace(/^zzzzz\d+/, '').replace(/^\d+px/, '').replace(/^sts2/, '');
  if (loose) keys.add(loose);
  const repeated = /^(.+?)\1$/.exec(loose);
  if (repeated) keys.add(repeated[1]);
  return keys;
}

/** Keep only source items requested by the board. Relinking uses this after it
 * has inspected the board and local cache, avoiding an entire catalog download. */
export function selectNamedItems(items, names) {
  if (!Array.isArray(names)) return items;
  const wanted = new Set(names.flatMap(name => [...itemNameKeys(name)]));
  return items.filter(item => [...itemNameKeys(item.name)].some(key => wanted.has(key)));
}

function extensionFor(url) {
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : '.png';
}

function mimeFor(extension) {
  return ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.svg': 'image/svg+xml', '.avif': 'image/avif' })[extension] || 'image/png';
}

async function materializeImages(items, mode, { directory, linkPrefix, onlyMissing = false }, log) {
  if (mode === 'remote') return;
  if (mode === 'local') await mkdir(directory, { recursive: true });
  let cursor = 0;
  const downloadNext = async () => {
    const index = cursor++;
    if (index >= items.length) return;
    const item = items[index];
    log(`  image ${index + 1}/${items.length}  ${item.name}`);
    try {
      const extension = extensionFor(item.src);
      const stem = `${item.key}_${item.name}`.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60);
      const filename = `${stem}${extension}`;
      const localImage = `${linkPrefix.replace(/\/$/, '')}/${filename}`;
      const localPath = path.join(directory, filename);
      if (mode === 'local' && onlyMissing) {
        try {
          await fileExists(localPath);
          item.img = localImage;
          log(`    using cached image`);
          return;
        } catch { /* cache miss: fetch it below */ }
      }
      const bytes = await requestBytes(item.src, { timeoutMs: 45_000 });
      if (mode === 'embed') item.img = `data:${mimeFor(extension)};base64,${bytes.toString('base64')}`;
      else {
        await writeFile(localPath, bytes);
        item.img = localImage;
      }
    } catch (error) {
      log(`      skipped: ${error.message}`);
    }
    await downloadNext();
  };
  // A small pool makes a full wiki refresh much faster without hammering the
  // source host or holding hundreds of requests open at once.
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, downloadNext));
}

function finishPack(raw, tags = []) {
  const items = raw.items.map(item => ({ id: item.key, key: item.key, tmkey: item.key,
    name: item.name, tags: [...tags], notes: '', img: item.img, src: item.src }));
  const known = new Set(raw.items.map(item => item.key));
  const tiers = raw.templateCode?.tiers?.length
    ? raw.templateCode.tiers.map(tier => ({ label: tier.label, color: tier.color,
      items: tier.ids.filter(id => known.has(id)) }))
    : [...'SABCDF'].map((label, index) => ({ label, color: TM_COLORS[index], items: [] }));
  const placed = new Set(tiers.flatMap(tier => tier.items));
  return { v: 1, title: raw.title, source: raw.source, tiers,
    pool: raw.items.map(item => item.key).filter(key => !placed.has(key)), items };
}

function imageMode(options) {
  if (options.embed) return 'embed';
  if (options.images) return 'local';
  return 'remote';
}

export async function importSource(url, options = {}) {
  const log = options.log || (() => {});
  const source = String(url).split('#')[0].replace(/^http:/, 'https:');
  const mode = imageMode(options);
  if (/slaythespire\.wiki\.gg/i.test(source)) {
    log('Reading wiki page...');
    const page = await fetchPage(source, log);
    const isRelicList = /(?:^|[_:/-])relics?(?:[_:/-]|$)/i.test(new URL(source).pathname);
    const wikiItems = isRelicList ? parseWikiRelics(page) : parseWikiCards(page);
    const itemType = isRelicList ? 'relics' : 'cards';
    if (!wikiItems.length) throw new Error(`no ${itemType} found - the wiki layout may have changed`);
    const cards = selectNamedItems(wikiItems, options.names);
    log(Array.isArray(options.names)
      ? `Found ${wikiItems.length} wiki ${itemType}; ${cards.length} match the current board`
      : `Found ${cards.length} ${itemType}`);
    await materializeImages(cards, mode, {
      directory: path.join(options.root, 'Images', 'sts2', isRelicList ? 'relics' : ''),
      linkPrefix: isRelicList ? 'Images/sts2/relics' : 'Images/sts2',
      onlyMissing: options.onlyMissing,
    }, log);
    const title = decodeHtml(/<title>([^<]*)<\/title>/i.exec(page)?.[1] || '').trim()
      .replace(/\s*[|–-]\s*Slay the Spire 2.*$/i, '').trim() || `Slay the Spire 2 ${isRelicList ? 'Relics' : 'Cards'}`;
    return { v: 1, title, source, tiers: [...'SABCDF'].map((label, index) => ({
      label, color: TM_COLORS[index], items: [],
    })), pool: cards.map(card => card.key), items: cards.map(card => ({
      id: card.key, key: card.key, name: card.name, tags: card.tags, notes: card.notes,
      img: card.img, src: card.src,
    })) };
  }

  let template = '';
  let title = '';
  let templateCode = null;
  if (/\/list\//i.test(source)) {
    log('Reading list page...');
    const page = await fetchPage(source, log);
    templateCode = parseTemplateCode(page);
    title = pageTitle(page);
    template = templateCode?.template || /\/list\/[^/]+\/([^/?]+)/i.exec(source)?.[1] || '';
    if (!templateCode) log('  ! no templateCode - importing the empty template');
  } else if (/\/create\//i.test(source)) {
    template = /\/create\/([^/?]+)/i.exec(source)?.[1] || '';
  } else {
    throw new Error('expected a TierMaker /list/ or /create/ URL, or a supported wiki URL');
  }
  if (!template) throw new Error('could not determine the template name from that URL');
  log(`Template: ${template}`);
  log('Reading template...');
  const result = await fetchTemplateItems(template, log);
  if (!result.items.length) throw new Error('no items found - TierMaker may have changed its data format');
  log(`Found ${result.items.length} items`);
  for (const item of result.items) item.img = item.src;
  await materializeImages(result.items, mode, {
    directory: path.join(options.root, 'Images', 'tiermaker'), linkPrefix: 'Images/tiermaker',
    onlyMissing: options.onlyMissing,
  }, log);
  return finishPack({ items: result.items, templateCode, title: title || pageTitle(result.page) || template,
    source }, options.tags || []);
}
