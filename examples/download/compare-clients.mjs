// Build first: npm ci. This probe downloads only two 1 MiB ranges per client.
import { Innertube, Platform, Constants, Log } from '../../dist/src/platform/node.js';

const videoId = process.argv[2];
if (!/^[\w-]{11}$/.test(videoId || '')) {
  throw new Error('Usage: node examples/download/compare-clients.mjs <video-id>');
}

Platform.shim.eval = async (data) => new Function(data.output)();
Log.setLevel(Log.Level.ERROR);
for (const client of ['IOS', 'VISIONOS']) {
  const youtube = await Innertube.create({
    generate_session_locally: true,
    retrieve_innertube_config: false,
    lang: 'en',
    location: 'US'
  });
  const info = await youtube.getBasicInfo(videoId, { client });
  const format = info.chooseFormat({ type: 'audio', format: 'mp4', quality: 'best' });
  const url = new URL(await format.decipher(youtube.session.player));
  if (info.cpn) url.searchParams.set('cpn', info.cpn);
  console.log(JSON.stringify({ client, itag: format.itag, totalBytes: format.content_length }));

  for (const start of [0, 1048576]) {
    const end = Math.min(start + 1048575, format.content_length - 1);
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('range', `${start}-${end}`);
    const response = await fetch(requestUrl, {
      headers: { ...Constants.STREAM_HEADERS, 'Accept-Encoding': 'identity' },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)
    });
    let bytes = 0;
    if (response.ok) {
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > end - start + 1) throw new Error('Server ignored the requested range');
      }
    } else {
      await response.body?.cancel();
    }
    // Never log signed URLs or account cookies.
    console.log(JSON.stringify({ client, start, end, status: response.status, bytes }));
  }
}
