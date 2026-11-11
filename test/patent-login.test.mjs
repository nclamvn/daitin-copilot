import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the browser submission after session expiry without a real password
// or network call. Preserve only the case and a permitted patent view.
test('patent login resumes the selected case and view and ignores unrelated return parameters', async () => {
  const script = readFileSync(new URL('../copilot/m5/login.js', import.meta.url), 'utf8');
  const id = '11111111-1111-4111-8111-111111111111';
  for (const [query, target, expected] of [
    ['?case=' + id, '/patents/', 'https://pilot.example/patents/?case=' + id],
    ['?case=' + id + '&view=documents', '/patents/', 'https://pilot.example/patents/?case=' + id + '&view=documents'],
    ['?case=' + id + '&view=%2Fapi%2Fpatents%2Fcases', '/patents/', 'https://pilot.example/patents/?case=' + id],
    ['?view=documents', '/patents/', 'https://pilot.example/patents/'],
    ['?case=' + id + '&view=documents', '/copilot/m3/workspace/', 'https://pilot.example/copilot/m3/workspace/?case=' + id],
    ['?case=https%3A%2F%2Fevil.example&next=https%3A%2F%2Fevil.example', '/patents/', 'https://pilot.example/patents/'],
    ['?case=' + id + '&next=https%3A%2F%2Fevil.example', '/patents/', 'https://pilot.example/patents/?case=' + id],
    ['?case=' + id, 'https://evil.example/', 'reload']
  ]) {
    let submit, destination;
    const button = { disabled: false };
    const form = { dataset: { returnTo: target }, elements: { key: { value: 'test-only' } },
      addEventListener(event, callback) { assert.equal(event, 'submit'); submit = callback; }, querySelector: () => button };
    const error = { hidden: true };
    runInNewContext(script, {
      document: { getElementById: id => id === 'login' ? form : error },
      FormData: class { get() { return 'test-only'; } }, URL,
      location: { origin: 'https://pilot.example', href: 'https://pilot.example/patents/' + query,
        assign(url) { destination = url; }, reload() { destination = 'reload'; } },
      fetch: async () => ({ ok: true })
    });
    await submit({ preventDefault() {} });
    assert.equal(destination, expected);
    assert.equal(form.elements.key.value, '');
  }
});
