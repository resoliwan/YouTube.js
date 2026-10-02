import assert from 'node:assert/strict';
import { test } from 'node:test';

const messages = [];
globalThis.NativeYoutube = { postMessage: (raw) => messages.push(JSON.parse(raw)) };
const { nativeFetch, completeHttp } = await import('./runtime.js');

test('native bridge retains auth headers and binary request/response bodies', async () => {
  const promise = nativeFetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { Cookie: 'session=value', Origin: 'https://www.youtube.com',
      'User-Agent': 'native-client', 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array([0, 255, 128, 65]),
  });
  // The bridge reads the body asynchronously before sending its message.
  await new Promise((resolve) => setImmediate(resolve));
  const request = messages.find((message) => message.type === 'http');
  assert.equal(request.headers.cookie, 'session=value');
  assert.equal(request.headers.origin, 'https://www.youtube.com');
  assert.equal(request.headers['user-agent'], 'native-client');
  assert.deepEqual([...Buffer.from(request.body, 'base64')], [0, 255, 128, 65]);
  completeHttp({ id: request.id, status: 200, headers: { 'content-type': 'application/octet-stream' },
    url: request.url, body: Buffer.from([255, 0, 129]).toString('base64') });
  const response = await promise;
  assert.equal(response.url, request.url);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [255, 0, 129]);
});
