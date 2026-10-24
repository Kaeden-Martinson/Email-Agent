// Builds the GitHub Pages site in docs/: privacy.html from PRIVACY_POLICY.md, and fills in the
// repository owner (from the git remote) in index.html and privacy.html. Run: npm run site
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

let owner = '__OWNER__';
try {
  const url = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  owner = url.match(/github\.com[:/]([^/]+)\//)?.[1] ?? owner;
} catch {
  console.warn('No git remote yet; links keep the __OWNER__ placeholder.');
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:[^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/(^|\s)(https:\/\/[^\s<]+)/g, '$1<a href="$2">$2</a>');

/** Just enough Markdown for the policy: headings, paragraphs, lists, bold, links. Drops the draft notice. */
function markdown(md) {
  const out = [];
  let list = false;
  for (const line of md.split(/\r?\n/)) {
    if (line.startsWith('>')) continue;
    if (/^- /.test(line)) {
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }
    if (list) out.push('</ul>');
    list = false;
    const h = line.match(/^(#{1,3}) (.*)/);
    if (h) out.push(`<h${h[1].length}>${inline(h[2].replace(/ \(draft\)$/, ''))}</h${h[1].length}>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('\n');
}

const index = readFileSync('docs/index.html', 'utf8');
const style = index.match(/<style>[\s\S]*?<\/style>/)[0];
const policy = markdown(readFileSync('docs/PRIVACY_POLICY.md', 'utf8'));
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Inbox Pilot privacy policy</title>
    ${style}
  </head>
  <body>
    <main>
${policy}
      <footer><a href="./">Inbox Pilot home</a></footer>
    </main>
  </body>
</html>
`;
const fill = (s) => s.replaceAll('__OWNER__', owner);
writeFileSync('docs/privacy.html', fill(page));
writeFileSync('docs/index.html', fill(index));
console.log(`Site built for github.com/${owner}/inbox-pilot`);
