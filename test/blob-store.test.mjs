import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionalETag } from '../web/blob-store.mjs';

test('private Blob resolves compressed weak GET validator only against matching strong HEAD metadata', async () => {
  let heads = 0;
  const etag = await conditionalETag('W/"original"', async () => { heads++; return { etag: '"original"' }; });
  assert.equal(etag, '"original"');
  assert.equal(heads, 1);
  assert.equal(await conditionalETag('"strong"', () => { throw new Error('No HEAD needed'); }), '"strong"');
});

test('private Blob rejects raced HEAD or weak origin metadata instead of assigning a fresh ETag to stale data', async () => {
  for (const etag of ['"newer"', 'W/"original"', '']) {
    await assert.rejects(() => conditionalETag('W/"original"', async () => ({ etag })), { status: 409 });
  }
  await assert.rejects(() => conditionalETag('', async () => ({ etag: '"unused"' })), { status: 503 });
});
