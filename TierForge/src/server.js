import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSource } from './importer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const savedDirectory = path.join(root, 'Saved');
const boardExtension = '.tierforge.json';
const jobs = new Map();
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.gif', 'image/gif'],
  ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'], ['.avif', 'image/avif'], ['.ico', 'image/x-icon'],
]);

function parseArguments(argv) {
  const options = { port: 8777, open: true };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port') options.port = Number(argv[++index]);
    else if (argv[index] === '--no-browser') options.open = false;
    else if (argv[index] === '--help' || argv[index] === '-h') options.help = true;
    else throw new Error(`unknown option: ${argv[index]}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error('port must be an integer from 1 to 65535');
  }
  return options;
}

function send(response, status, body, contentType = 'application/json; charset=utf-8') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, {
    'content-type': contentType, 'content-length': bytes.length,
    'access-control-allow-origin': '*', 'cache-control': 'no-store',
  });
  response.end(bytes);
}

function json(response, status, value) {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8');
}

function safeBoardName(raw) {
  const name = decodeURIComponent(raw).replace(/[^A-Za-z0-9 _-]+/g, '_').trim().slice(0, 80);
  return name || null;
}

async function readBody(request, limit = 75 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) throw Object.assign(new Error('request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function listBoards(response) {
  await mkdir(savedDirectory, { recursive: true });
  const boards = [];
  for (const entry of await readdir(savedDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(boardExtension) || entry.name.startsWith('_')) continue;
    const details = await stat(path.join(savedDirectory, entry.name));
    boards.push({ name: entry.name.slice(0, -boardExtension.length), mtime: details.mtimeMs });
  }
  boards.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  json(response, 200, { boards });
}

async function collectImages(directory, prefix = '') {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const images = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) images.push(...await collectImages(path.join(directory, entry.name), relative));
    else if (mimeTypes.has(path.extname(entry.name).toLowerCase()) &&
             mimeTypes.get(path.extname(entry.name).toLowerCase()).startsWith('image/')) images.push(relative);
  }
  return images;
}

async function listImages(response) {
  const files = (await collectImages(path.join(root, 'Images')))
    .map(file => `Images/${file.split(path.sep).join('/')}`);
  json(response, 200, { images: files });
}

function boardPath(rawName) {
  const name = safeBoardName(rawName);
  if (!name) throw Object.assign(new Error('bad board name'), { status: 400 });
  return path.join(savedDirectory, `${name}${boardExtension}`);
}

async function getBoard(rawName, response) {
  try {
    send(response, 200, await readFile(boardPath(rawName)), 'application/json; charset=utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, { error: 'not found' });
    throw error;
  }
}

async function putBoard(rawName, request, response) {
  const target = boardPath(rawName);
  const body = await readBody(request);
  try { JSON.parse(body.toString('utf8')); } catch (error) {
    return json(response, 400, { error: `invalid JSON: ${error.message}` });
  }
  await mkdir(savedDirectory, { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, body);
  await rename(temporary, target);
  json(response, 200, { ok: true });
}

async function deleteBoard(rawName, response) {
  try { await unlink(boardPath(rawName)); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  json(response, 200, { ok: true });
}

async function renameBoard(rawName, request, response) {
  const source = boardPath(rawName);
  let input;
  try { input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}'); }
  catch (error) { return json(response, 400, { error: `invalid JSON: ${error.message}` }); }
  if (typeof input.name !== 'string' || !input.name.trim()) {
    return json(response, 400, { error: 'name must be a non-empty string' });
  }

  const nextName = safeBoardName(encodeURIComponent(input.name));
  if (!nextName) return json(response, 400, { error: 'bad board name' });
  const target = boardPath(encodeURIComponent(nextName));
  if (source === target) return json(response, 200, { ok: true, name: nextName });

  try { await access(source); }
  catch (error) { if (error.code === 'ENOENT') return json(response, 404, { error: 'not found' }); throw error; }
  try { await access(target); return json(response, 409, { error: 'a board with that name already exists' }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const body = await readFile(source);
  let board;
  try { board = JSON.parse(body.toString('utf8')); }
  catch (error) { return json(response, 500, { error: `saved board is invalid JSON: ${error.message}` }); }
  board.title = nextName;
  await writeFile(target, JSON.stringify(board));
  await unlink(source);
  json(response, 200, { ok: true, name: nextName });
}

function importOptions(url) {
  return {
    root,
    embed: ['1', 'true', 'yes'].includes(url.searchParams.get('embed')),
    images: ['1', 'true', 'yes'].includes(url.searchParams.get('images')),
    onlyMissing: ['1', 'true', 'yes'].includes(url.searchParams.get('cache')),
    tags: (url.searchParams.get('tags') || '').split(',').map(tag => tag.trim()).filter(Boolean),
  };
}

async function synchronousImport(url, response) {
  const source = url.searchParams.get('url');
  if (!source) return json(response, 200, {
    helper: 'tierforge', runtime: 'node', version: 2, import: '/import?url=',
  });
  const result = await importSource(source, {
    ...importOptions(url), log: message => process.stderr.write(`${message}\n`),
  });
  json(response, 200, result);
}

async function startImport(request, url, response) {
  const source = url.searchParams.get('url');
  if (!source) return json(response, 400, { error: 'missing url' });
  let names;
  if (request.method === 'POST') {
    let input;
    try { input = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8') || '{}'); }
    catch (error) { return json(response, 400, { error: `invalid JSON: ${error.message}` }); }
    if (input.names !== undefined && (!Array.isArray(input.names) ||
        input.names.some(name => typeof name !== 'string'))) {
      return json(response, 400, { error: 'names must be an array of strings' });
    }
    names = input.names;
  }
  const id = randomUUID().replaceAll('-', '').slice(0, 12);
  const job = { lines: [`Import: ${source}`], done: false, result: null, error: null, touched: Date.now() };
  jobs.set(id, job);
  importSource(source, { ...importOptions(url), names, log: message => job.lines.push(message) })
    .then(result => { job.result = result; job.done = true; job.touched = Date.now(); })
    .catch(error => { job.error = error.message; job.done = true; job.touched = Date.now(); });
  json(response, 200, { job: id });
}

function pollImport(url, response) {
  const id = url.searchParams.get('job');
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  const job = jobs.get(id);
  if (!job) return json(response, 404, { error: 'unknown job' });
  job.touched = Date.now();
  const payload = { lines: job.lines.slice(since), total: job.lines.length, done: job.done };
  if (job.done) {
    if (job.error) payload.error = job.error;
    else payload.result = job.result;
    jobs.delete(id);
  }
  json(response, 200, payload);
}

async function staticFile(pathname, response) {
  const relative = pathname === '/' ? 'tierforge.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return json(response, 403, { error: 'forbidden' });
  try {
    const details = await stat(target);
    if (!details.isFile()) return json(response, 404, { error: 'not found' });
    const contentType = mimeTypes.get(path.extname(target).toLowerCase()) || 'application/octet-stream';
    send(response, 200, await readFile(target), contentType);
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, { error: 'not found' });
    throw error;
  }
}

async function route(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': '*',
      'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS' });
    return response.end();
  }
  if (request.method === 'GET' && pathname === '/health') return json(response, 200, { ok: true, runtime: 'node' });
  if (request.method === 'GET' && pathname === '/images') return listImages(response);
  if (request.method === 'GET' && pathname === '/boards') return listBoards(response);
  if (pathname.startsWith('/boards/')) {
    const name = pathname.slice('/boards/'.length);
    if (request.method === 'GET') return getBoard(name, response);
    if (request.method === 'PUT') return putBoard(name, request, response);
    if (request.method === 'POST' && name.endsWith('/rename')) {
      return renameBoard(name.slice(0, -'/rename'.length), request, response);
    }
    if (request.method === 'DELETE') return deleteBoard(name, response);
  }
  if (request.method === 'GET' && ['/import', '/api/import'].includes(pathname)) return synchronousImport(url, response);
  if (['GET', 'POST'].includes(request.method) && pathname === '/import/start') {
    return startImport(request, url, response);
  }
  if (request.method === 'GET' && pathname === '/import/poll') return pollImport(url, response);
  if (request.method === 'GET' || request.method === 'HEAD') return staticFile(url.pathname, response);
  json(response, 404, { error: 'not found' });
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

export function createTierForgeServer() {
  return createServer((request, response) => {
    route(request, response).catch(error => {
      process.stderr.write(`  !! ${error.stack || error}\n`);
      if (!response.headersSent) json(response, error.status || 500, { error: error.message });
      else response.end();
    });
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: npm run serve -- [--port 8777] [--no-browser]\n');
    return;
  }
  await Promise.all([mkdir(savedDirectory, { recursive: true }), access(root)]);
  const server = createTierForgeServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${options.port}/`;
  process.stderr.write(`\nTierForge is running at ${url}\nBoards: ${savedDirectory}\nImages: ${path.join(root, 'Images')}\n\nCtrl+C to stop.\n\n`);
  if (options.open) setTimeout(() => openBrowser(url), 350);
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  setInterval(() => {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [id, job] of jobs) if (job.done && job.touched < cutoff) jobs.delete(id);
  }, 60_000).unref();
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`TierForge could not start: ${error.message}\n`);
    process.exitCode = 1;
  });
}
