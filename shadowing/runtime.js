// Version policy: package.json.version identifies this app runtime bundle;
// dependencies.youtubei.js identifies the official library separately.
// Record the bundle version before shipping it in the app. The app runs a
// cached bundle only if newer than its built-in bundle, and downloads a release
// only after its metadata reports a version newer than both local versions.
// Bump the bundle version when runtime behavior or the library changes.

import { Innertube, Platform, Constants, Log } from '../dist/src/platform/web.js';
import runtimePackage from '../package.json' with { type: 'json' };

export const version = runtimePackage.version;

// All HTTP uses the app's client, so WebView CORS rules don't affect extraction.
const requests = new Map();
let sequence = 0;
const send = (message) => NativeYoutube.postMessage(JSON.stringify(message));

function encodeBytes(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

export async function nativeFetch(input, init) {
  // Browser Request filters Cookie/Origin/User-Agent. Preserve the original
  // header bag because the actual transport is native HTTP, not browser fetch.
  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : {}));
  const request = new Request(input, init);
  const body = ['GET', 'HEAD'].includes(request.method)
    ? null : encodeBytes(new Uint8Array(await request.arrayBuffer()));
  const id = ++sequence;
  const response = await new Promise((resolve, reject) => {
    requests.set(id, { resolve, reject });
    send({ type: 'http', id, url: request.url, method: request.method,
      headers: Object.fromEntries(headers), body });
  });
  const bytes = Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0));
  const result = new Response([204, 205, 304].includes(response.status) ? null : bytes,
    { status: response.status, headers: response.headers });
  Object.defineProperty(result, 'url', { value: response.url });
  return result;
}

export function completeHttp(message) {
  const pending = requests.get(message.id);
  if (!pending) return;
  requests.delete(message.id);
  if (message.error) pending.reject(new Error(message.error));
  else pending.resolve(message);
}

export async function extract(videoId, session = {}) {
  try {
    // Requests run through native HTTP, which can send Origin/User-Agent headers.
    Platform.shim.server = true;
    Platform.shim.eval = async (data) => new Function(data.output)();
    Log.setLevel(Log.Level.ERROR);
    // Reuse the app's YouTube session for the initial player request as well as
    // authenticated fallbacks. CDN downloads still use only stream headers.
    const cookie = session.cookie || undefined;
    const profiles = [{ client: 'VISIONOS', cookie },
      ...(session.signedIn ? ['WEB', 'WEB_CREATOR'].map((client) =>
        ({ client, cookie: session.cookie })) : [])];
    let youtube;
    let info;
    let format;
    let unavailableReason;
    for (const profile of profiles) {
      youtube = await Innertube.create({
        fetch: nativeFetch, lang: 'en', location: 'US',
        cookie: profile.cookie,
        generate_session_locally: !profile.cookie,
        retrieve_innertube_config: false,
      });
      info = await youtube.getBasicInfo(videoId, { client: profile.client });
      if (info.playability_status?.status !== 'OK') {
        unavailableReason = info.playability_status?.reason || 'Video unavailable';
        continue;
      }
      if (info.basic_info.is_live || info.basic_info.is_upcoming) {
        throw new Error('Live audio is unsupported');
      }
      const candidates = (info.streaming_data?.adaptive_formats || [])
        .filter((entry) => entry.has_audio && !entry.has_video &&
          (entry.url || entry.signature_cipher || entry.cipher) &&
          !entry.drm_families?.length &&
          /^audio\/(mp4|webm)(;|$)/.test(entry.mime_type));
      // Prefer M4A for native decoding, then the highest bitrate.
      candidates.sort((a, b) =>
        Number(b.mime_type.startsWith('audio/mp4')) - Number(a.mime_type.startsWith('audio/mp4')) ||
        Number(Boolean(b.is_original)) - Number(Boolean(a.is_original)) || b.bitrate - a.bitrate);
      format = candidates[0];
      if (format) break;
    }
    if (!format) throw new Error(unavailableReason || '이 영상에서 다운로드할 수 있는 오디오 주소를 제공하지 않았어요.');
    if (!format.has_audio || format.has_video) throw new Error('Audio-only format unavailable');
    const url = new URL(await format.decipher(youtube.session.player));
    if (info.cpn) url.searchParams.set('cpn', info.cpn);
    send({ type: 'result', videoId, title: info.basic_info.title,
      creator: info.basic_info.author || info.basic_info.channel?.name,
      durationSeconds: info.basic_info.duration,
      url: url.toString(), mimeType: format.mime_type.split(';')[0],
      contentLength: format.content_length,
      headers: { ...Constants.STREAM_HEADERS, 'Accept-Encoding': 'identity' } });
  } catch (error) {
    send({ type: 'error', message: error.message || String(error) });
  }
}

send({ type: 'ready' });
