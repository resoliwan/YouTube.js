import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Innertube } from '../dist/src/platform/web.js';

const messages = [];
globalThis.NativeYoutube = { postMessage: (raw) => messages.push(JSON.parse(raw)) };
const { nativeFetch, completeHttp, extract } = await import('./runtime.js');

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

test('authenticated fallback skips URL-less formats and retains account cookies', async (t) => {
  const calls = [];
  const cookie = 'SAPISID=test-only';
  t.mock.method(Innertube, 'create', async (options) => {
    assert.equal(options.cookie, options.generate_session_locally ? undefined : cookie);
    return {
      session: { player: {} },
      getBasicInfo: async (_, { client }) => {
        calls.push(client);
        return {
          playability_status: { status: 'OK' },
          basic_info: { title: 'Example', duration: 60 },
          streaming_data: { adaptive_formats: [
            { has_audio: true, has_video: false, mime_type: 'audio/mp4',
              bitrate: 256000, decipher: () => { throw new Error('No valid URL to decipher'); } },
            ...(client === 'WEB_CREATOR' ? [{ has_audio: true, has_video: false,
              mime_type: 'audio/mp4; codecs="mp4a.40.2"', content_length: 4096,
              bitrate: 128000, url: 'https://r1.googlevideo.com/videoplayback',
              decipher: async () => 'https://r1.googlevideo.com/videoplayback' }] : []),
          ] },
        };
      },
    };
  });
  messages.length = 0;
  await extract('1VQNMDSzWpE', { cookie, signedIn: true });
  assert.deepEqual(calls, ['VISIONOS', 'WEB', 'WEB_CREATOR']);
  assert.equal(messages.at(-1).type, 'result');
  assert.equal(messages.at(-1).mimeType, 'audio/mp4');
});

test('public audio uses the verified anonymous profile even while signed in', async (t) => {
  const calls = [];
  t.mock.method(Innertube, 'create', async (options) => {
    assert.equal(options.cookie, undefined);
    assert.equal(options.generate_session_locally, true);
    assert.equal(options.location, 'US');
    return {
      session: { player: {} },
      getBasicInfo: async (_, { client }) => {
        calls.push(client);
        return {
          playability_status: { status: 'OK' },
          basic_info: { title: 'Public example', duration: 61 }, cpn: 'test-cpn',
          streaming_data: { adaptive_formats: [{
            has_audio: true, has_video: false, mime_type: 'audio/mp4',
            content_length: 994815, bitrate: 128000,
            url: 'https://r1.googlevideo.com/videoplayback',
            decipher: async () => 'https://r1.googlevideo.com/videoplayback',
          }] },
        };
      },
    };
  });
  messages.length = 0;
  await extract('7CeNTtbhYLs', { cookie: 'SAPISID=test-only', signedIn: true });
  assert.deepEqual(calls, ['VISIONOS']);
  const result = messages.at(-1);
  assert.equal(result.type, 'result');
  assert.equal(result.headers.origin, 'https://www.youtube.com');
  assert.equal(result.headers.referer, 'https://www.youtube.com');
  assert.equal(result.headers['User-Agent'], undefined);
  assert.equal(new URL(result.url).searchParams.get('cpn'), 'test-cpn');
});
