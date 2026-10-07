# Audio downloads and client selection

The client that provides streaming URLs can affect whether the CDN accepts
subsequent range requests. An `OK` player response alone does not prove that
an entire file can be downloaded.

For public audio, the existing `VISIONOS` client is an alternative to `IOS`:

```js
const stream = await youtube.download(videoId, {
  client: 'VISIONOS',
  type: 'audio',
  format: 'mp4',
  quality: 'best'
});
```

This selects a YouTube API profile, not the OS running your application. It is
not a guarantee for every video, account, or network. Keep client selection
explicit and respect any authentication requirements.

## Reproduce an IOS range failure

After `npm ci`, run:

```sh
node examples/download/compare-clients.mjs bHuqXhGB1p0
```

The probe retrieves fresh M4A URLs for both clients, uses identical HTTP headers,
and reads the first two 1 MiB ranges. It prints status codes and byte counts,
without signed URLs or cookies.

Observed on 2026-10-07 with YouTube.js 18.1.0, without login cookies:

| Client | itag | Bytes 0–1048575 | Bytes 1048576–2097151 |
| --- | --- | --- | --- |
| IOS | 140 | 200, 1048576 bytes | 403, 0 bytes |
| VISIONOS | 140 | 200, 1048576 bytes | 200, 1048576 bytes |

Changing the IOS request to an HTTP `Range` header or changing its download
User-Agent did not resolve the failure. Keeping the same transport and changing
only the extraction client to VISIONOS allowed all 29,770,476 bytes to download
and decode. This isolates the behavior to the issued streaming URL/client
context; the server-side reason for rejecting IOS ranges remains unknown.
