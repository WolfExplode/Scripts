import test from 'node:test';
import assert from 'node:assert/strict';
import { createTierForgeServer } from '../src/server.js';

test('server exposes health and helper discovery interfaces', async t => {
  const server = createTierForgeServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, runtime: 'node' });
  const helper = await (await fetch(`${base}/import`)).json();
  assert.equal(helper.helper, 'tierforge');
  assert.equal(helper.runtime, 'node');
  const images = (await (await fetch(`${base}/images`)).json()).images;
  assert.ok(images.every(image => image.startsWith('Images/')));
  const badNames = await fetch(`${base}/import/start?url=https%3A%2F%2Fexample.com`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"names":"not-an-array"}',
  });
  assert.equal(badNames.status, 400);
  assert.deepEqual(await badNames.json(), { error: 'names must be an array of strings' });

  const original = `__rename-test-${Date.now()}`;
  const renamed = `${original}-renamed`;
  const board = await fetch(`${base}/boards/${encodeURIComponent(original)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: original, tiers: [], pool: [], items: {} }),
  });
  assert.equal(board.status, 200);
  const rename = await fetch(`${base}/boards/${encodeURIComponent(original)}/rename`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: renamed }),
  });
  assert.deepEqual(await rename.json(), { ok: true, name: renamed });
  assert.equal((await (await fetch(`${base}/boards/${encodeURIComponent(renamed)}`)).json()).title, renamed);
  await fetch(`${base}/boards/${encodeURIComponent(renamed)}`, { method: 'DELETE' });
});
