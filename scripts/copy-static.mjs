// Copies the renderer's static files (html, css, fonts) next to its compiled JS, and the app icon to dist/assets.
import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';

mkdirSync('dist/web/renderer', { recursive: true });
for (const file of ['index.html']) {
  if (existsSync(`src/renderer/${file}`)) cpSync(`src/renderer/${file}`, `dist/web/renderer/${file}`);
}
// The legacy stylesheet was removed in 0.14.0; drop any copy left over from an older build.
rmSync('dist/web/renderer/styles.css', { force: true });
for (const dir of ['css', 'fonts']) cpSync(`src/renderer/${dir}`, `dist/web/renderer/${dir}`, { recursive: true });
// App icon (window and tray): src/assets → dist/assets, found by main.js at ../assets/icon.png.
cpSync('src/assets', 'dist/assets', { recursive: true });
