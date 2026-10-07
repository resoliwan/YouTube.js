# Shadowing runtime distribution

Commits to `main` build the native WebView bridge and publish `youtubejs.zip` on
the fork's GitHub Release. The release tag and embedded manifest use the existing
`package.json` version; this workflow never bumps the upstream version or publishes
to npm. The app installs only a strictly newer version, so rebuilding the same
version replaces the asset for new installations but does not update existing ones.

`runtime.js` exposes `ShadowingYoutube.extract` and `completeHttp`, using the
`NativeYoutube` message channel. YouTube requests and cookies stay on the device.
Public audio first uses anonymous `VISIONOS`: IOS URLs can reject ranges past
the first MiB with HTTP 403. If no downloadable format is available, signed-in
requests can fall back to `WEB` and `WEB_CREATOR`. Public requests do not send
account cookies. Native HTTP/download logic stays in the Flutter app.

Build locally:

```sh
npm ci
node --test shadowing/runtime.node-test.mjs
node dev-scripts/build-shadowing-bundle.mjs
```

The ZIP contains the runtime, its HTML host, licenses, and `manifest.json` with
schema/bridge versions, upstream version, source commit, and SHA-256 file hashes.
It does not include source maps, Node, or a Python runtime.
