// Copies the renderer's static files next to its compiled JS.
import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/web/renderer', { recursive: true });
for (const file of ['index.html', 'styles.css']) {
  cpSync(`src/renderer/${file}`, `dist/web/renderer/${file}`);
}
