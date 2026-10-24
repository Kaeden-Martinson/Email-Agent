import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { messageText, verifyItem } from '../src/main/core/extract';
import { extractPdfText, isPdf } from '../src/main/core/pdf';

/** A minimal one-page PDF with the given lines of text (correct xref offsets). */
export function makePdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\()]/g, (c) => `\${c}`);
  const stream = `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

describe('PDF attachments', () => {
  it('recognizes PDFs by type or name', () => {
    assert.ok(isPdf('bill.PDF', 'application/octet-stream'));
    assert.ok(isPdf('x', 'application/pdf'));
    assert.ok(!isPdf('photo.jpg', 'image/jpeg'));
  });
  it('extracts the text of a PDF', async () => {
    const text = await extractPdfText(makePdf(['Invoice 4471', 'Amount due: $182.40', 'Due date: November 14, 2026']));
    assert.match(text, /Invoice 4471/);
    assert.match(text, /Amount due: \$182\.40/);
    assert.match(text, /November 14, 2026/);
  });
  it('caps the text it returns', async () => {
    const text = await extractPdfText(makePdf(Array.from({ length: 40 }, (_, i) => `Line number ${i} with some words`)), { maxBytes: 1e6, maxPages: 1, maxChars: 100 });
    assert.ok(text.length <= 100);
  });
  it('refuses oversized files and rejects garbage', async () => {
    await assert.rejects(extractPdfText(new Uint8Array(20), { maxBytes: 10, maxPages: 1, maxChars: 10 }), /too large/);
    await assert.rejects(extractPdfText(new TextEncoder().encode('not a pdf at all')));
  });
  it('lets a bill found only in the PDF pass verification', async () => {
    const attachmentText = await extractPdfText(makePdf(['Statement for October', 'Amount due: $182.40', 'Payment due by November 14, 2026']));
    const msg = { subject: 'Your statement is ready', body: 'Your October statement is attached.', attachmentText };
    const draft = { kind: 'bill' as const, title: 'Card payment', date: '2026-11-14', time: '', amount: 182.4, currency: 'USD', evidence: 'Amount due: $182.40' };
    // With the PDF text the amount is confirmed; without it the amount is left out as unverified.
    assert.equal(verifyItem(draft, messageText(msg), new Date(2026, 9, 20))?.amount, 182.4);
    assert.equal(verifyItem(draft, messageText({ ...msg, attachmentText: undefined }), new Date(2026, 9, 20))?.amount, undefined);
  });
});
