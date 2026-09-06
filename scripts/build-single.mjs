/**
 * Builds the whole game into one self-contained HTML file.
 *
 * That file is what gets distributed and what the desktop launcher opens: it
 * has no imports, no sibling assets and no server, so it runs from a plain
 * file:// double-click on a machine with nothing installed. The bundle is
 * emitted as an IIFE rather than an ES module on purpose -- module scripts are
 * subject to CORS, and a file:// page has an opaque origin, so a `type=module`
 * build refuses to load exactly where this one has to work.
 */
import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stageDir = path.join(root, 'node_modules', '.jsrf-single');
const outFile = path.join(root, 'game', 'JetSetRadioFuture.html');

await build({
  root,
  base: './',
  logLevel: 'warn',
  build: {
    outDir: stageDir,
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      input: path.join(root, 'src', 'main.js'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
        assetFileNames: 'game.[ext]',
      },
    },
  },
});

const js = fs.readFileSync(path.join(stageDir, 'game.js'), 'utf8');
const cssPath = path.join(stageDir, 'game.css');
const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
const favicon = fs.readFileSync(path.join(root, 'public', 'favicon.svg'), 'utf8');

// A literal </script> anywhere in the bundle would close the tag early.
const safeJs = js.replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}" />
    <title>JET SET RADIO FUTURE</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet" />
    <style>${css}</style>
  </head>
  <body>
    <div id="app">
      <canvas id="viewport"></canvas>
      <div id="ui"></div>
    </div>
    <noscript>This game needs JavaScript and WebGL.</noscript>
    <script>${safeJs}</script>
  </body>
</html>
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
fs.rmSync(stageDir, { recursive: true, force: true });

const kb = (html.length / 1024).toFixed(0);
console.log(`Wrote ${path.relative(root, outFile)} (${kb} KB)`);
