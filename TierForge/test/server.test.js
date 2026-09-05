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
});
