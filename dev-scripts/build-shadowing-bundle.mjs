import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

const root = new URL('../', import.meta.url);
const output = new URL('build/shadowing/', root);
await mkdir(output, { recursive: true });
await build({
  entryPoints: [new URL('shadowing/runtime.js', root).pathname],
  outfile: new URL('runtime.js', output).pathname,
  bundle: true,
  format: 'iife',
  globalName: 'ShadowingYoutube',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  keepNames: true,
  legalComments: 'inline',
});

const { version } = JSON.parse(await readFile(new URL('package.json', root)));
const files = {
  'runtime.js': await readFile(new URL('runtime.js', output)),
  'runtime.html': await readFile(new URL('shadowing/runtime.html', root)),
  'LICENSE': await readFile(new URL('LICENSE', root)),
};
files['licenses/protobuf-es.txt'] = await readFile(new URL('shadowing/licenses/protobuf-es.txt', root));
const varint = await readFile(new URL('node_modules/@bufbuild/protobuf/dist/esm/wire/varint.js', root), 'utf8');
files['licenses/protobuf-bsd.txt'] = Buffer.from(varint.slice(0, varint.indexOf('/**')).replace(/^\/\/ ?/gm, ''));
files['licenses/fflate.txt'] = await readFile(new URL('node_modules/fflate/LICENSE', root));
files['licenses/meriyah.txt'] = await readFile(new URL('node_modules/meriyah/LICENSE.md', root));
const manifest = {
  schemaVersion: 1,
  version,
  bridgeVersion: 1,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
  files: Object.entries(files).map(([path, bytes]) => ({
    path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  })),
};
files['manifest.json'] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
// Fixed timestamps make identical source bundles reproducible.
const date = new Date('2020-01-01T00:00:00Z');
const archive = zipSync(Object.fromEntries(Object.entries(files).map(([path, bytes]) =>
  [path, [bytes, { mtime: date }]])), { level: 9 });
await writeFile(new URL('youtubejs.zip', output), archive);
console.log(JSON.stringify({ version, zipBytes: archive.length, runtimeBytes: files['runtime.js'].length }));
