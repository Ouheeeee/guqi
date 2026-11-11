import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const site = path.join(root, 'site');
const outDir = path.join(root, 'dist');
const outFile = path.join(outDir, 'guqi-standalone.html');

let html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(site, 'styles.css'), 'utf8');
const game = fs.readFileSync(path.join(site, 'game.js'), 'utf8');
const app = fs.readFileSync(path.join(site, 'app.js'), 'utf8');
const favicon = fs.readFileSync(path.join(site, 'favicon.svg'), 'utf8');

const faviconData = `data:image/svg+xml;base64,${Buffer.from(favicon).toString('base64')}`;
const gameInline = game.replace(/^export\s+/gm, '');
const appInline = app.replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/game\.js['"];\s*/m, '');

if (!html.includes('./styles.css') || !html.includes('./app.js') || !html.includes('./favicon.svg')) {
  throw new Error('Expected asset references were not found in index.html');
}

html = html
  .replace('<link rel="icon" href="./favicon.svg" type="image/svg+xml">', `<link rel="icon" href="${faviconData}" type="image/svg+xml">`)
  .replace('<link rel="stylesheet" href="./styles.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="./app.js"></script>',
    `<script type="module">\n${gameInline}\n\n${appInline}\n</script>`,
  );

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, html);
console.log(`Built ${path.relative(root, outFile)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB)`);
