// Text from PDF attachments (bills, invoices, tickets), so dates and amounts inside them can be found.
// Runs locally with pdf.js: no scripts, no network, nothing rendered; only the text layer is read.

import * as path from 'node:path';

export const PDF_LIMITS = { maxBytes: 10 * 1024 * 1024, maxPages: 8, maxChars: 6000 };

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | undefined;

/** pdf.js ships only as an ES module; load it once, on first use. */
function load(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** pdf.js's bundled character maps and font metrics (inside the app package). */
const assets = () => path.join(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')), '..', '..').replace(/\\/g, '/');

export const isPdf = (name: string, mimeType: string) => /pdf/i.test(mimeType) || /\.pdf$/i.test(name);

/** Joins text items into lines; collapses whitespace; stops at `maxChars`. */
export async function extractPdfText(data: Uint8Array, limits = PDF_LIMITS): Promise<string> {
  if (data.byteLength > limits.maxBytes) throw new Error('The PDF is too large to read.');
  const { getDocument } = await load();
  const task = getDocument({
    data: new Uint8Array(data), // pdf.js takes ownership of the buffer
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
    verbosity: 0,
    // Character maps and the standard fonts' metrics, so text in CJK and older PDFs comes out right.
    cMapUrl: `${assets()}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets()}/standard_fonts/`,
  });
  try {
    const doc = await task.promise;
    let out = '';
    for (let p = 1; p <= Math.min(doc.numPages, limits.maxPages) && out.length < limits.maxChars; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          out += line.replace(/\s+/g, ' ').trim() + '\n';
          line = '';
        } else if (!item.str.endsWith(' ')) {
          line += ' ';
        }
      }
      if (line.trim()) out += line.replace(/\s+/g, ' ').trim() + '\n';
      page.cleanup();
    }
    return out.replace(/\n{3,}/g, '\n\n').trim().slice(0, limits.maxChars);
  } finally {
    await task.destroy();
  }
}
