// The Document as pdf.js renders it: page thumbnails, the page canvas, highlight boxes over quotes, and pick mode
// (a pdf.js text layer: click a line, or drag a selection, to pick a quote for a Challenge).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Rect } from "../api.ts";
import { Spinner } from "./ui.tsx";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface ViewerBox {
  id: string;
  page: number;
  rects: Rect[];
  kind: "selected" | "quoted" | "notStated" | "challenged" | "pick" | "delivered" | "challenger";
  tag?: string;
  title: string;
  /** Several Fields quote these words: a click opens a picker listing them. */
  fields?: { id: string; label: string }[];
}

const INK = "#141414", RED = "#A3221B", AMBER = "#6B4400";
/** Box look per kind, from the prototype's viewer lines. A notStated box with a tag is the selected one. */
const BOX: Record<ViewerBox["kind"], { bg: string; ol: string; tagBg: string }> = {
  selected: { bg: "#ECE5D3", ol: `2px solid ${INK}`, tagBg: INK },
  quoted: { bg: "transparent", ol: "1px dashed #8E877A", tagBg: INK },
  notStated: { bg: "var(--hatch)", ol: "1px solid #B9862A", tagBg: AMBER },
  challenged: { bg: "transparent", ol: `2px solid ${RED}`, tagBg: RED },
  pick: { bg: "#EFE9DA", ol: `2px dashed ${INK}`, tagBg: INK },
  delivered: { bg: "transparent", ol: `2px solid ${RED}`, tagBg: RED },
  challenger: { bg: "#ECE5D3", ol: `2px solid ${INK}`, tagBg: INK },
};
const PAD_X = 5, PAD_Y = 3;
const MAX_PAGE_WIDTH = 760;

const cache = new Map<string, Promise<PDFDocumentProxy>>();
const load = (url: string) => {
  if (!cache.has(url)) cache.set(url, getDocument({ url }).promise);
  return cache.get(url)!;
};

/** Draw page `n` at `width` CSS px into a fresh canvas (pdf.js refuses two renders on one canvas). */
async function draw(pdf: PDFDocumentProxy, n: number, width: number) {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  const page = await pdf.getPage(n);
  const scale = width / page.getViewport({ scale: 1 }).width;
  const viewport = page.getViewport({ scale });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const task = page.render({ canvas, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
  return { task, page, viewport, canvas };
}

export function DocumentViewer({ pdfUrl, page, onPage, boxes, onBoxClick, pick, caption, thumbnails = true }: {
  pdfUrl: string; page: number; onPage(n: number): void; boxes: ViewerBox[]; onBoxClick(id: string): void;
  pick?: { onPick(p: { page: number; quote: string }): void }; caption?: string; thumbnails?: boolean;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    setPdf(undefined);
    load(pdfUrl).then((p) => live && setPdf(p), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [pdfUrl]);

  const pages = pdf?.numPages ?? 0;
  const selectedPage = boxes.find((b) => b.kind === "selected" || (b.kind === "notStated" && b.tag))?.page;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: "var(--viewer-bg)" }}>
      {thumbnails && (
        <Thumbnails pdf={pdf} pages={pages} current={page} marked={new Set(boxes.map((b) => b.page))} selectedPage={selectedPage} onPage={onPage} />
      )}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "10px 20px", borderBottom: "1px solid var(--rule)", font: "400 13px/1.3 var(--sans)", color: "#2A2723" }}>
          <span style={{ font: "500 13px/1 var(--mono)" }}>p. {page} of {pages || "…"}</span>
          {caption && <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{caption}</span>}
        </div>
        {pick && (
          <div style={{ flex: "none", padding: "10px 20px", background: INK, color: "var(--paper)", font: "500 14px/1.3 var(--sans)", display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ font: "600 13px/1 var(--mono)" }}>→</span>Click the line on the Document that states the value. Use the thumbnails to change page.
          </div>
        )}
        {error ? (
          <div style={{ padding: 28, font: "500 14px/1.4 var(--sans)", color: RED }}>The Document could not be opened: {error}</div>
        ) : pdf ? (
          <PageView pdf={pdf} page={Math.min(Math.max(1, page), pages)} boxes={boxes.filter((b) => b.page === page)} onBoxClick={onBoxClick} pick={pick} />
        ) : (
          <div style={{ padding: 28, display: "flex", gap: 12, alignItems: "center", font: "500 15px/1 var(--sans)" }}><Spinner />Opening the Document…</div>
        )}
      </div>
    </div>
  );
}

function PageView({ pdf, page, boxes, onBoxClick, pick }: {
  pdf: PDFDocumentProxy; page: number; boxes: ViewerBox[]; onBoxClick(id: string): void; pick?: { onPick(p: { page: number; quote: string }): void };
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const textLayer = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number; scale: number }>();
  /** The open picker: a box several Fields share, and where it was clicked. */
  const [picker, setPicker] = useState<{ box: ViewerBox; x: number; y: number }>();
  useEffect(() => setPicker(undefined), [page, boxes.length]);

  useEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setWidth(Math.min(MAX_PAGE_WIDTH, Math.floor(el.clientWidth - 56))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (width <= 0) return;
    let live = true;
    let cancel = () => {};
    draw(pdf, page, width).then(({ task, viewport, page: p, canvas }) => {
      cancel = () => task.cancel();
      if (!live) return task.cancel();
      task.promise.then(() => live && host.current?.replaceChildren(canvas), () => {});
      setSize({ w: viewport.width, h: viewport.height, scale: viewport.scale });
      const layer = textLayer.current;
      if (!layer) return;
      layer.replaceChildren();
      if (pick) new TextLayer({ textContentSource: p.streamTextContent(), container: layer, viewport }).render().catch(() => {});
    });
    return () => { live = false; cancel(); };
  }, [pdf, page, width, !!pick]);

  // Bring the selected box into view; otherwise start at the top of the page.
  const target = boxes.find((b) => b.kind === "selected" || b.kind === "challenger" || b.tag);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !size) return;
    const y = target?.rects[0] ? target.rects[0].y * size.h : 0;
    el.scrollTo({ top: Math.max(0, y - 160), behavior: target ? "smooth" : "auto" });
  }, [page, target?.id, size?.h]);

  const onMouseUp = (e: React.MouseEvent) => {
    if (!pick) return;
    const sel = getSelection();
    const selected = sel?.toString().replace(/\s+/g, " ").trim();
    if (selected && textLayer.current?.contains(sel!.anchorNode)) {
      sel!.removeAllRanges();
      return pick.onPick({ page, quote: selected });
    }
    const span = (e.target as HTMLElement).closest(".textLayer span");
    if (span) pick.onPick({ page, quote: lineOf(span as HTMLElement) });
  };

  return (
    <div ref={scroller} style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative", padding: "24px 28px 48px" }}>
      <div
        onMouseUp={onMouseUp}
        style={{
          position: "relative", margin: "0 auto", width: size?.w, background: "#FFFFFF", border: "1px solid var(--page-border)",
          ["--total-scale-factor" as string]: size?.scale ?? 1, ["--scale-round-x" as string]: "1px", ["--scale-round-y" as string]: "1px",
        } as CSSProperties}
      >
        <div ref={host} style={{ width: size?.w, height: size?.h, lineHeight: 0 }} />
        {size && boxes.map((b, i) => (
          <Box key={`${b.id}:${i}`} box={b} w={size.w} h={size.h} picking={!!pick}
            onClick={() => {
              const r = b.rects[0]!;
              if (b.fields) setPicker({ box: b, x: r.x * size.w - PAD_X, y: (r.y + r.h) * size.h + PAD_Y + 4 });
              else onBoxClick(b.id);
            }} />
        ))}
        {picker && (
          <div role="menu" aria-label="Fields quoting these words"
            style={{ position: "absolute", left: picker.x, top: picker.y, zIndex: 3, background: "#FFFFFF", border: `1px solid ${INK}`, boxShadow: "0 4px 14px rgba(20,20,20,.18)", display: "flex", flexDirection: "column", minWidth: 180 }}>
            <span style={{ padding: "8px 12px 4px", font: "600 10.5px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#3D3A34" }}>{picker.box.fields!.length} Fields quote this</span>
            {picker.box.fields!.map((f) => (
              <button key={f.id} role="menuitem" onClick={() => { setPicker(undefined); onBoxClick(f.id); }}
                style={{ textAlign: "left", border: 0, borderTop: "1px solid var(--rule-row)", background: "transparent", padding: "9px 12px", font: "500 14px/1.2 var(--sans)", color: INK, cursor: "pointer" }}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {pick && <div ref={textLayer} className="textLayer" />}
      </div>
    </div>
  );
}

/** The whole line a text span sits on: every span with (about) the same top, left to right. */
export function lineOf(span: HTMLElement): string {
  const top = span.getBoundingClientRect().top, h = span.getBoundingClientRect().height || 1;
  const spans = [...(span.parentElement?.querySelectorAll<HTMLElement>("span") ?? [])].filter((s) => Math.abs(s.getBoundingClientRect().top - top) < h / 2);
  return spans.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left).map((s) => s.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
}

function Box({ box, w, h, picking, onClick }: { box: ViewerBox; w: number; h: number; picking: boolean; onClick(): void }) {
  const s = BOX[box.kind];
  const ol = box.kind === "notStated" && box.tag ? `2px solid ${AMBER}` : s.ol;
  return (
    <>
      {box.rects.map((r, i) => (
        <div key={i} title={box.fields ? box.fields.map((f) => f.label).join(" · ") : box.title} onClick={picking ? undefined : onClick} data-box={box.kind}
          style={{
            position: "absolute", left: r.x * w - PAD_X, top: r.y * h - PAD_Y, width: r.w * w + 2 * PAD_X, height: r.h * h + 2 * PAD_Y,
            outline: ol, outlineOffset: -1, cursor: picking ? "inherit" : "pointer", pointerEvents: picking ? "none" : "auto",
          }}>
          <div className="om-motion" style={{ position: "absolute", inset: 0, background: s.bg, mixBlendMode: "multiply", transition: "background .25s" }} />
          {box.tag && i === 0 && (
            <span style={{ position: "absolute", right: 8, top: -9, background: s.tagBg, color: "#FFFFFF", font: "600 10px/1 var(--sans)", letterSpacing: ".06em", textTransform: "uppercase", padding: "3px 6px", whiteSpace: "nowrap" }}>
              {box.tag}
            </span>
          )}
        </div>
      ))}
    </>
  );
}

function Thumbnails({ pdf, pages, current, marked, selectedPage, onPage }: {
  pdf?: PDFDocumentProxy; pages: number; current: number; marked: Set<number>; selectedPage?: number; onPage(n: number): void;
}) {
  return (
    <div style={{ width: 76, flex: "none", overflow: "auto", borderRight: "1px solid var(--rule)", padding: "12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
        <button key={n} onClick={() => onPage(n)} aria-label={`Page ${n}`}
          style={{ position: "relative", flex: "none", border: `${current === n ? 2 : 1}px solid ${current === n ? INK : "var(--page-border)"}`, background: "#FFFFFF", padding: 0, cursor: "pointer", lineHeight: 0 }}>
          {pdf && <Thumb pdf={pdf} n={n} />}
          <span style={{ position: "absolute", left: 6, bottom: 5, font: "600 10px/1 var(--mono)", color: "#2A2723" }}>{n}</span>
          {marked.has(n) && <span style={{ position: "absolute", right: 5, bottom: 5, width: 7, height: 7, background: selectedPage === n ? INK : "var(--grey)" }} />}
        </button>
      ))}
    </div>
  );
}

function Thumb({ pdf, n }: { pdf: PDFDocumentProxy; n: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let live = true, task: { cancel(): void } | undefined;
    draw(pdf, n, 52).then((d) => {
      task = d.task;
      if (!live) return d.task.cancel();
      d.task.promise.then(() => live && ref.current?.replaceChildren(d.canvas), () => {});
    });
    return () => { live = false; task?.cancel(); };
  }, [pdf, n]);
  return <span ref={ref} style={{ display: "block", width: 52, minHeight: 68 }} />;
}
