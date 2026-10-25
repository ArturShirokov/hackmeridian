import { getDocumentProxy } from "unpdf";
import type { Rect } from "./api.js";

/** One text item of a page, in fractions of the page, top-left origin. */
export interface TextItem extends Rect {
  str: string;
  eol: boolean;
}

/**
 * One string per page (index 0 = page 1) and its text items. All empty = a scan with no text layer. Throws on a non-PDF.
 * The text is the items joined as unpdf's extractText joins them, so quotes checked against it line up with the items.
 */
export async function readPdf(bytes: Uint8Array): Promise<{ text: string[]; items: TextItem[][] }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes)); // copy: pdfjs detaches the buffer
  const items: TextItem[][] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { width: W, height: H } = page.getViewport({ scale: 1 });
    // ponytail: assumes unrotated pages with a viewBox at the origin; use viewport.convertToViewportRectangle for rotated ones.
    const content = await page.getTextContent();
    items.push(
      content.items.flatMap((it) => {
        if (!("str" in it)) return [];
        const [, , c, d, e, f] = it.transform as number[];
        const h = it.height || Math.hypot(c!, d!);
        return [{ str: it.str, eol: it.hasEOL, x: e! / W, y: (H - f! - h) / H, w: it.width / W, h: h / H }];
      }),
    );
  }
  return { text: items.map((p) => p.map((i) => i.str + (i.eol ? "\n" : "")).join("")), items };
}

/** Just the text, one string per page. */
export const pageTexts = async (bytes: Uint8Array) => (await readPdf(bytes)).text;

/** Whitespace collapsed, as converge.ts compares quotes. */
export const fold = (s: string) => s.replace(/\s+/g, " ").trim();

/** Boxes around `quote` on one page's items: the overlapped items, trimmed by characters, merged per line. [] when not found. */
export function quoteRects(items: TextItem[], quote: string): Rect[] {
  // The page's folded text, with the item and the offset in it of each character.
  let s = "";
  const at: { item: number; off: number }[] = [];
  items.forEach((it, k) => {
    [...(it.str + (it.eol ? "\n" : ""))].forEach((ch, off) => {
      const space = /\s/.test(ch);
      if (space && (s === "" || s.endsWith(" "))) return;
      s += space ? " " : ch;
      at.push({ item: k, off });
    });
  });
  const q = fold(quote);
  if (!q) return [];
  let start = s.indexOf(q);
  if (start < 0) start = s.toLowerCase().indexOf(q.toLowerCase());
  if (start < 0) return [];
  const span = new Map<number, [number, number]>();
  for (const { item, off } of at.slice(start, start + q.length)) {
    const [a, b] = span.get(item) ?? [off, off];
    span.set(item, [Math.min(a, off), Math.max(b, off + 1)]);
  }
  const rects: Rect[] = [];
  for (const [k, [a, b]] of span) {
    const it = items[k]!;
    const n = it.str.length || 1;
    const r = { x: it.x + (it.w * a) / n, y: it.y, w: (it.w * (Math.min(b, n) - a)) / n, h: it.h };
    if (r.w <= 0) continue;
    const line = rects.find((o) => Math.abs(o.y - r.y) < r.h / 2);
    if (!line) rects.push(r);
    else {
      const x2 = Math.max(line.x + line.w, r.x + r.w);
      line.x = Math.min(line.x, r.x);
      line.w = x2 - line.x;
    }
  }
  return rects;
}
