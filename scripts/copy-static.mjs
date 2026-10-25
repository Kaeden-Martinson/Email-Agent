// Copies the renderer's static files (html, css, fonts) next to its compiled JS.
import { cpSync, mkdirSync, existsSync } from 'node:fs';

mkdirSync('dist/web/renderer', { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  if (existsSync(`src/renderer/${file}`)) cpSync(`src/renderer/${file}`, `dist/web/renderer/${file}`);
}
for (const dir of ['css', 'fonts']) cpSync(`src/renderer/${dir}`, `dist/web/renderer/${dir}`, { recursive: true });
