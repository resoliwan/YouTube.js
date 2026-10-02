import { Innertube, Platform, Constants, Log } from '../dist/src/platform/web.js';

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
    const youtube = await Innertube.create({
      fetch: nativeFetch,
      lang: 'en',
      location: 'KR',
      cookie: session.cookie || undefined,
      generate_session_locally: false,
      retrieve_innertube_config: false,
    });
    // Cookie authentication belongs to the WEB client, not mobile client profiles.
    const client = session.signedIn ? 'WEB' : 'IOS';
    const info = await youtube.getBasicInfo(videoId, { client });
    if (info.playability_status?.status !== 'OK') {
      throw new Error(info.playability_status?.reason || 'Video unavailable');
    }
    if (info.basic_info.is_live || info.basic_info.is_upcoming) {
      throw new Error('Live audio is unsupported');
    }
    let format;
    try {
      format = info.chooseFormat({ type: 'audio', format: 'mp4', quality: 'best' });
    } catch {
      format = info.chooseFormat({ type: 'audio', format: 'webm', quality: 'best' });
    }
    if (!format.has_audio || format.has_video) throw new Error('Audio-only format unavailable');
    const url = new URL(await format.decipher(youtube.session.player));
    if (info.cpn) url.searchParams.set('cpn', info.cpn);
    send({ type: 'result', videoId, title: info.basic_info.title,
      creator: info.basic_info.author || info.basic_info.channel?.name,
      durationSeconds: info.basic_info.duration,
      url: url.toString(), mimeType: format.mime_type.split(';')[0],
      contentLength: format.content_length,
      headers: { 'User-Agent': Constants.CLIENTS[client].USER_AGENT,
        'Accept': '*/*', 'Accept-Encoding': 'identity' } });
  } catch (error) {
    send({ type: 'error', message: error.message || String(error) });
  }
}

send({ type: 'ready' });
