# Shadowing runtime distribution

Commits to `main` build the native WebView bridge and publish `youtubejs.zip` on
the fork's GitHub Release. The release tag and embedded manifest use the existing
`package.json` version; this workflow never bumps the upstream version or publishes
to npm. The app installs only a strictly newer version, so rebuilding the same
version replaces the asset for new installations but does not update existing ones.

`runtime.js` exposes `ShadowingYoutube.extract` and `completeHttp`, using the
`NativeYoutube` message channel. YouTube requests and cookies stay on the device.
The unauthenticated player request uses the `IOS` client profile; authenticated
requests use `WEB`. Native HTTP/download logic stays in the Flutter app.

Build locally:

```sh
npm ci
node --test shadowing/runtime.node-test.mjs
node dev-scripts/build-shadowing-bundle.mjs
```

The ZIP contains the runtime, its HTML host, licenses, and `manifest.json` with
schema/bridge versions, upstream version, source commit, and SHA-256 file hashes.
It does not include source maps, Node, or a Python runtime.

The same ZIP is mirrored to `bundles/<version>/youtubejs.zip` on the `bundles`
branch for browser clients: GitHub Release redirects do not allow cross-origin
fetch, while raw.githubusercontent.com does. Both downloads are checked against
the Release asset's SHA-256 digest; native clients use the Release asset directly.
