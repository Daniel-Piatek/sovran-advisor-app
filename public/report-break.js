// A report's break line (2026-11-17, the owner's wish). The Sovran Pattern's Part Five has one line that reads
// <div class="break"></div>. It is drawn as a short centred gold bar and is never shown as text, however it arrives:
// as it is, with &lt; &gt; &quot; in place of < > ", or with single quotes. Used by the reading view (public/reports.js)
// and by the server, which gives the assistant a plain * * * there instead (reports.js).

const LT = '(?:<|&lt;|&#0*60;)';
const GT = '\\\\?(?:>|&gt;|&#0*62;)';
const Q = '(?:"|\'|&quot;|&#0*34;|&#0*39;|&apos;)?';
export const BREAK = new RegExp(`\\\\?${LT}\\s*div\\s+class\\s*=\\s*${Q}break${Q}\\s*\\/?\\s*${GT}(?:\\s*\\\\?${LT}\\s*\\/\\s*div\\s*${GT})?`, 'gi');

// The text with each break line in place of a word of its own, set apart as its own paragraph.
const MARK = 'SOVRAN-REPORT-BREAK';
export const markBreaks = (text) => String(text ?? '').replace(BREAK, `\n\n${MARK}\n\n`);

// The text for the assistant: each break line as a Markdown rule.
export const plainBreaks = (text) => String(text ?? '').replace(BREAK, '\n\n* * *\n\n');

// After the text is drawn: each break's paragraph becomes the gold bar; any stray mark is taken out.
export function drawBreaks(root) {
  for (const p of [...root.querySelectorAll('p')]) {
    if (p.textContent.trim() !== MARK) continue;
    const bar = root.ownerDocument.createElement('div');
    bar.className = 'report-break';
    bar.setAttribute('role', 'separator');
    p.replaceWith(bar);
  }
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* text */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.data.includes(MARK)) node.data = node.data.split(MARK).join('');
  }
}
