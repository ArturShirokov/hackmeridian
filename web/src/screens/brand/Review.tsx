// Brand: the Document review. Money and status bar, the Document viewer (left), Operator tabs with Fields,
// Not stated cards and Compare (right), the Challenge side panel, Supplier Request and Export modals.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, usePoll, ApiFailure, type ApiConfig, type ApiDocument, type ApiField, type ApiPipelineView, type ApiTemplate, type ChallengeBody } from "../../api.ts";
import { shortHash, splitMark, usdc } from "../../format.ts";
import { FieldRow, pageOf } from "../../components/FieldRow.tsx";
import { DocumentViewer } from "../../components/DocumentViewer.tsx";
import { spanTree } from "../../components/SieveTrack.tsx";
import { clamp2, Countdown, Modal, MoneyChip, ProofLink, SectionLabel, SidePanel } from "../../components/ui.tsx";
import { useServerClock } from "../../screens.tsx";
import { Loading, MobileView, useDocument } from "./common.tsx";
import { boxes, compare, parseClaim, pipelineState, reviewGroups, settledText, shown, windowLabel, withShown } from "./derive.ts";
import { JsonView, MarkdownView, SourceMarkdown, TraceView, VIEWS, type View } from "./views.tsx";

const INK = "#141414", RED = "#A3221B", AMBER = "#6B4400";
type Final = Extract<ApiField, { evidence: unknown }>;
type NotStated = Extract<ApiField, { quotes: unknown }>;
type TemplateField = ApiTemplate["fields"][number];

export function BrandReview({ id }: { id: string }) {
  const { data: d, error } = useDocument(id);
  const { config, offset } = useServerClock();
  const { data: templates } = usePoll(api.templates, 60_000);
  // Opening the Review starts a demo Challenge Window (once every Operator has delivered).
  const waiting = !!d && pipelineState(d).delivered && d.views.some((v) => v.escrow?.paused === "until opened");
  useEffect(() => { if (waiting) void api.open(id); }, [waiting, id]);
  if (!d) return <Loading error={error} />;
  const tpl = templates?.find((t) => t.name === d.template);
  const unopened = d.views.some((v) => v.escrow?.paused === "until opened");
  return (
    <>
      <ReviewView d={d} config={config} offset={offset} template={tpl} file={(body) => api.challenge(d.id, body)} />
      <MobileView d={d} view={d.views[0]!} live={false} config={config} offset={offset} />
    </>
  );
}

const windowOpen = (v: ApiPipelineView | undefined, offset: number) =>
  !!v?.escrow && v.escrow.status === "delivered" && (v.escrow.paused ? v.escrow.msLeft > 0 : v.escrow.closesAt > Date.now() + offset);
/** A delivered Field with no Challenge yet: Final, or Not stated ("the Document does state it, on page X"). One Challenge per Field. */
const challengeable = (f: ApiField) => ("evidence" in f || "quotes" in f) && !f.challenge;

export function ReviewView({ d, config, offset, template, file }: {
  d: ApiDocument; config?: ApiConfig; offset: number; template?: ApiTemplate; file(body: ChallengeBody): Promise<unknown>;
}) {
  const q = new URLSearchParams(location.search);
  const [tab, setTab] = useState(() => q.get("pipeline") ?? d.views[0]!.pipeline);
  const [viewTab, setViewTab] = useState<View>("Review");
  const [sel, setSel] = useState<string | undefined>(() => q.get("field") ?? undefined);
  const [exp, setExp] = useState<string | undefined>(sel);
  const [page, setPage] = useState(1);
  const [panel, setPanel] = useState<{ pipeline: string; field: string; pick?: { page: number; quote: string }; filed?: boolean }>();
  const [modal, setModal] = useState<{ kind: "sr"; text: string } | { kind: "export" }>();

  const isCompare = tab === "compare";
  const view = d.views.find((v) => v.pipeline === tab) ?? d.views[0]!;
  const fields = view.fields;
  const groups = reviewGroups(fields);
  const order = isCompare ? fields.map((f) => f.name) : groups.order;
  const brand = config?.brand.name ?? "the Brand";
  const e = view.escrow;
  const settled = e?.status === "settled";
  const open = windowOpen(view, offset);

  const select = (name: string, expand = false) => {
    setSel(name);
    if (expand) setExp(name);
    const f = fields.find((x) => x.name === name);
    const p = f && pageOf(f);
    if (p) setPage(p);
  };
  // A Field picked on the Document, or by keys, scrolls its row (or its Not stated card and quotes) into view;
  // the page's default first selection doesn't (a ?field= deep link does).
  const prevSel = useRef(sel);
  useEffect(() => {
    const was = prevSel.current;
    prevSel.current = sel;
    if (sel && (was !== undefined || q.get("field"))) document.querySelector(`[data-review] [data-field="${sel}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [sel, tab]);
  /** Open the Challenge panel on a Field of any Operator, only while its Challenge Window is open; jump to its page. */
  const openPanel = (name: string, pipeline = view.pipeline) => {
    const v = d.views.find((x) => x.pipeline === pipeline)!;
    const f = v.fields.find((x) => x.name === name);
    if (!f || !windowOpen(v, offset) || !challengeable(f)) return;
    setSel(name);
    setExp(name);
    const p = pageOf(f);
    if (p) setPage(p);
    setPanel({ pipeline, field: name });
  };

  // The prototype's page starts on the selected Field (or a ?field= deep link); the dock's 05 opens a Challenge.
  useEffect(() => {
    const start = sel ?? fields.find((f) => "evidence" in f)?.name;
    if (start) select(start, !!sel);
    if (q.get("challenge")) {
      const target = fields.find((f) => f.name === sel && challengeable(f)) ?? fields.find(challengeable);
      if (target) openPanel(target.name);
    }
  }, []);

  useEffect(() => {
    const k = (ev: KeyboardEvent) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target as HTMLElement)?.tagName ?? "") || modal) return;
      const i = sel ? order.indexOf(sel) : -1;
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const j = Math.max(0, Math.min(order.length - 1, i + (ev.key === "ArrowDown" ? 1 : -1)));
        setSel(order[j]);
        const p = pageOf(fields.find((f) => f.name === order[j])!);
        if (p) setPage(p);
        if (exp) setExp(order[j]);
      } else if (ev.key === "Enter" && sel) setExp(exp === sel ? undefined : sel);
      else if ((ev.key === "c" || ev.key === "C") && open && !panel && sel && !ev.metaKey && !ev.ctrlKey) {
        const f = fields.find((x) => x.name === sel);
        if (f && challengeable(f)) openPanel(sel);
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  const selF = fields.find((f) => f.name === sel);
  const onPage = selF && ("evidence" in selF ? selF.evidence.page === page : "quotes" in selF && selF.quotes.some((x) => x.page === page));
  const quotedHere = fields.filter((f) => ("evidence" in f && f.evidence.page === page) || ("quotes" in f && f.quotes.some((x) => x.page === page))).length;
  const caption = onPage
    ? `Highlighted: ${selF.label} — “${"evidence" in selF ? (selF.evidence.mark ?? selF.evidence.quote) : "competing statements"}”`
    : `${quotedHere} Field${quotedHere === 1 ? "" : "s"} quoted on this page`;
  const panelView = panel && d.views.find((v) => v.pipeline === panel.pipeline);
  const panelField = panelView?.fields.find((f) => f.name === panel!.field);
  const panelOpen = windowOpen(panelView, offset);
  const picking = !!panel && !panel.filed && panelOpen;

  const bond = (v: ApiPipelineView) => {
    const x = v.escrow!;
    const slashed = Number(x.bond) - Number(x.bondLeft);
    return (
      <MoneyChip key={v.pipeline} tone="bond" label={`Bond · ${v.label}`} amount={x.bondLeft}
        state={x.status === "settled" ? "released" : x.upheld ? "slashed" : "locked"}
        split={x.upheld ? `${usdc(String(slashed))} USDC slashed to ${brand}` : undefined} />
    );
  };
  const upheldNote = (v: ApiPipelineView): ReactNode => {
    const x = v.escrow;
    if (!x?.upheld) return undefined;
    const each = usdc(String((Number(x.bond) - Number(x.bondLeft)) / x.upheld));
    return x.status === "settled"
      ? <>Slash {each} USDC paid to {brand}<ProofLink href={x.settlementLink} hash={x.settlementLink?.split("/").at(-1) ?? ""} /></>
      : <>Slash {each} USDC paid to {brand} when the Window closes</>;
  };

  return (
    <div className="om-desktop-only" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={{ flex: "none", padding: "12px 24px", borderBottom: `1px solid ${INK}`, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 20px", background: "var(--surface)" }}>
        <div style={{ minWidth: 160, flex: "0 1 320px" }}>
          {/* Wraps (at its hyphens), never clipped; the full file name on hover. */}
          <div title={d.name} style={{ font: "600 15px/1.25 var(--sans)", overflowWrap: "anywhere" }}>{d.name.replace(/\.pdf$/i, "")}</div>
          <div style={{ marginTop: 3, font: "400 13px/1.2 var(--sans)", color: "#3D3A34" }}>{d.supplier || "—"} · {template?.label ?? d.template} passport</div>
        </div>
        {(isCompare ? d.views : [view]).filter((v) => v.escrow).map(bond)}
        {e && <MoneyChip tone="fee" label="Fee" amount={e.fee} state={settled ? "paid" : "held"} />}
        {e && config && <Countdown closesAt={e.closesAt} msLeft={e.msLeft} paused={e.paused} windowMs={config.challengeWindowMs} serverOffsetMs={offset} settled={settled} note={windowLabel(config)} />}
        {e && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, whiteSpace: "nowrap" }} data-testid="output-hash">
            <SectionLabel size={10.5}>Output hash</SectionLabel>
            {/* Each Operator's own: in Compare one line per Operator. */}
            {(isCompare ? d.views : [view]).filter((v) => v.escrow).map((v) => (
              <span key={v.pipeline} style={{ display: "flex", gap: 8, alignItems: "baseline", whiteSpace: "nowrap" }}>
                <span style={{ font: "500 13px/1 var(--mono)" }}>{isCompare && `${v.label} `}{shortHash(v.escrow!.outputHash)}</span>
                <ProofLink href={v.escrow!.link} hash="" />
              </span>
            ))}
          </div>
        )}
        {!e && <span style={{ font: "500 13px/1.3 var(--mono)", color: "#3D3A34" }}>{view.label} is still working on this Document.</span>}
        <button className="om-btn primary md" style={{ marginLeft: "auto" }} disabled={!e} onClick={() => setModal({ kind: "export" })}>Export to passport</button>
      </div>
      {e && settled && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 18, padding: "12px 24px", borderBottom: "1px solid var(--settled-ink)", background: "var(--settled-bg)", color: "var(--settled-ink)", font: "600 15px/1.3 var(--sans)" }}>
          <span style={{ width: 20, height: 20, borderRadius: "50%", background: "var(--settled-ink)", color: "#FFFFFF", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 11px/1 var(--mono)" }}>✓</span>
          <span>Settled. The Challenge Window closed. {settledText(e, view.label)}</span>
          {e.settlementLink && <span style={{ marginLeft: "auto" }}><ProofLink href={e.settlementLink} hash={e.settlementLink.split("/").at(-1) ?? ""} label="Settlement" color="var(--settled-ink)" /></span>}
        </div>
      )}
      {/* The Fields get the wider side so their names fit on two lines; the page scales to its column. */}
      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,41fr) minmax(0,59fr)" }}>
        {/* The viewer is clipped to its column, so it never draws under the Fields. */}
        <div style={{ minHeight: 0, minWidth: 0, display: "flex", overflow: "clip", contain: "paint", borderRight: `1px solid ${INK}` }}>
          <DocumentViewer pdfUrl={d.fileUrl} page={page} onPage={setPage} onBoxClick={(n) => select(n)} caption={caption}
            boxes={boxes(isCompare ? d.views[0]!.fields : fields, sel)}
            pick={picking ? { onPick: (p) => setPanel({ ...panel!, pick: p }) } : undefined} />
        </div>
        {/* clip, not hidden: a hidden box can still be scrolled (by focus or scrollIntoView), shifting the Challenge panel sideways. */}
        <div style={{ minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column", position: "relative", overflow: "clip", background: "var(--paper)" }}>
          <div role="tablist" aria-label="View" style={{ flex: "none", display: "flex", borderBottom: "1px solid var(--rule)", padding: "0 20px", gap: 2, background: "var(--surface)" }}>
            {VIEWS.map((k) => (
              <button key={k} role="tab" aria-selected={k === viewTab} onClick={() => { setViewTab(k); setPanel(undefined); if (k !== "Review" && isCompare) setTab(d.views[0]!.pipeline); }}
                style={{ height: 38, padding: "0 10px", background: "transparent", border: 0, borderBottom: `2px solid ${k === viewTab ? INK : "transparent"}`, marginBottom: -1, font: `${k === viewTab ? 600 : 500} 13px/1 var(--sans)`, color: INK, cursor: "pointer", whiteSpace: "nowrap", flex: "none" }}>
                {k}
              </button>
            ))}
          </div>
          <div role="tablist" aria-label="Operator" style={{ flex: "none", display: "flex", borderBottom: `1px solid ${INK}`, padding: "0 20px", gap: 4 }}>
            {[...d.views.map((v) => ({ k: v.pipeline, label: v.label, meta: `${v.stations.length} Sieve${v.stations.length === 1 ? "" : "s"}` })),
              ...(d.views.length > 1 && viewTab === "Review" ? [{ k: "compare", label: "Compare", meta: `${d.differs.length} differ` }] : [])].map((t) => (
              <button key={t.k} role="tab" aria-selected={t.k === (isCompare ? "compare" : view.pipeline)} onClick={() => { setTab(t.k); setPanel(undefined); }}
                style={{ height: 50, padding: "0 14px", background: "transparent", border: 0, borderBottom: `3px solid ${t.k === (isCompare ? "compare" : view.pipeline) ? INK : "transparent"}`, marginBottom: -1, font: `${t.k === (isCompare ? "compare" : view.pipeline) ? 600 : 500} 15px/1 var(--sans)`, color: INK, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", flex: "none" }}>
                {t.label}<span style={{ font: "500 12px/1 var(--mono)", color: "#3D3A34" }}>{t.meta}</span>
              </button>
            ))}
            <span title="↑ ↓ move · Enter quote · C Challenge" aria-label="Keys: ↑ ↓ move, Enter quote, C Challenge"
              style={{ marginLeft: "auto", alignSelf: "center", flex: "none", padding: "3px 6px", border: "1px solid var(--rule)", font: "500 11px/1 var(--mono)", color: "#3D3A34", cursor: "help" }}>Keys</span>
          </div>
          <div data-review key={viewTab} style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            {viewTab === "JSON" ? <JsonView d={d} v={view} template={template} />
            : viewTab === "Markdown" ? <MarkdownView d={d} v={view} template={template} />
            : viewTab === "Source Markdown" ? <SourceMarkdown v={view} />
            : viewTab === "Trace" ? <TraceView spans={view.trace && spanTree(view.trace)} />
            : isCompare ? <CompareTab d={d} sel={sel} onSelect={(n) => select(n)} canChallenge={(v, f) => windowOpen(v, offset) && challengeable(f)} onChallenge={openPanel} /> : (
              <>
                {/* Supplier-authored Not stated Fields share one Supplier Request; the Brand's are "Brand to provide". */}
                {([["Not stated", groups.supplier], ["Brand to provide", groups.brand]] as const).map(([title, list]) => list.length > 0 && (
                  <div key={title}>
                    <div style={{ padding: "14px 20px 6px", font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: AMBER }}>{title} · {list.length}</div>
                    {list.map((f) => {
                      const text = view.supplierRequest ?? (f as NotStated).supplierRequest;
                      return (
                        <NotStatedCard key={f.name} field={f as NotStated} selected={sel === f.name} onSelect={() => select(f.name, true)}
                          onChallenge={open && challengeable(f) ? () => openPanel(f.name) : undefined} operator={view.label}
                          onQuote={(p) => { setSel(f.name); setPage(p); }} onRequest={f.author === "Brand" || !text ? undefined : () => setModal({ kind: "sr", text })} />
                      );
                    })}
                  </div>
                ))}
                {groups.sections.map((s) => (
                  <div key={s.section}>
                    <div style={{ padding: "10px 20px 6px", font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" }}>{s.section} · {s.fields.length}</div>
                    {s.fields.map((f) => (
                      <FieldRow key={f.name} field={withShown(f)} selected={sel === f.name} expanded={exp === f.name} tieBreak={f.tieBreak}
                        canChallenge={open && challengeable(f)} upheldNote={upheldNote(view)}
                        onSelect={() => select(f.name, true)} onToggle={() => setExp(exp === f.name ? undefined : f.name)} onChallenge={() => openPanel(f.name)} />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>
          <SidePanel open={!!panel} onClose={() => setPanel(undefined)} title="Challenge a Field">
            {panel && panelView && panelField && ("evidence" in panelField || "quotes" in panelField) && (
              <ChallengePanel key={`${panel.pipeline}/${panel.field}`} operator={panelView.label} field={panelField}
                templateField={template?.fields.find((f) => f.name === panel.field)} closed={panelView.escrow?.status === "settled" ? "settled" : panelOpen ? undefined : "closed"}
                slash={panelView.escrow ? usdc(String(Number(panelView.escrow.bond) / 10)) : undefined} deposit={config?.challengeDeposit} pick={panel.pick} onClearPick={() => setPanel({ ...panel, pick: undefined })}
                file={(b) => file({ pipeline: panel.pipeline, field: panel.field, ...b }).then(() => setPanel((p) => p && { ...p, filed: true }))} onClose={() => setPanel(undefined)} />
            )}
          </SidePanel>
        </div>
      </div>
      <Modal open={modal?.kind === "sr"} onClose={() => setModal(undefined)} title={`Supplier Request · ${d.supplier || "Supplier"}`}>
        {modal?.kind === "sr" && <SupplierRequest text={modal.text} onClose={() => setModal(undefined)} />}
      </Modal>
      <Modal open={modal?.kind === "export"} onClose={() => setModal(undefined)} title="Export to passport">
        {modal?.kind === "export" && e && (
          <>
            <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ margin: 0, font: "400 15px/1.55 var(--sans)", color: "#2A2723" }}>
                {groups.rows.length} Final Field{groups.rows.length === 1 ? "" : "s"} from the {view.label} go into the passport file.
                {groups.notStated.length > 0 && ` ${groups.notStated.map((f) => f.label).join(", ")} ${groups.notStated.length === 1 ? "is" : "are"} held back as Not stated until ${d.supplier || "the Supplier"} answers the Supplier Request.`}
              </p>
              <div style={{ font: "500 13px/1.4 var(--mono)" }}>{d.name.replace(/\.pdf$/i, "")}.passport.json · output hash {shortHash(e.outputHash)}</div>
            </div>
            <div style={{ padding: "0 22px 20px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="om-btn ghost" style={{ height: 42, padding: "0 16px" }} onClick={() => setModal(undefined)}>Close</button>
              <a className="om-btn primary" style={{ height: 42, padding: "0 18px", fontSize: 14, textDecoration: "none" }} href={api.exportUrl(d.id, view.pipeline)} download>Download passport JSON</a>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function CompareTab({ d, sel, onSelect, canChallenge, onChallenge }: {
  d: ApiDocument; sel?: string; onSelect(name: string): void;
  canChallenge(v: ApiPipelineView, f: ApiField): boolean; onChallenge(name: string, pipeline: string): void;
}) {
  const c = compare(d);
  const cols = `minmax(0,1fr) ${d.views.map(() => "minmax(0,1.1fr)").join(" ")} 84px`;
  return (
    <>
      <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--rule)", font: "500 14px/1.3 var(--sans)" }}>{c.summary}</div>
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: 10, padding: "10px 20px", borderBottom: "1px solid var(--rule)", font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" }}>
        <span>Field</span>{d.views.map((v) => <span key={v.pipeline}>{v.label}</span>)}<span></span>
      </div>
      {c.rows.map((r) => (
        <div key={r.name} onClick={() => onSelect(r.name)} data-field={r.name}
          style={{ display: "grid", gridTemplateColumns: cols, gap: 10, alignItems: "center", padding: "0 20px", minHeight: 48, borderBottom: "1px solid var(--rule-row)", background: sel === r.name ? "var(--row-selected)" : "transparent", cursor: "pointer" }}>
          <span style={{ font: "500 14px/1.25 var(--sans)" }}>{r.label}</span>
          {r.values.map((v, i) => {
            const view = d.views[i]!, f = view.fields.find((x) => x.name === r.name)!;
            return (
              <span key={i} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, minWidth: 0, padding: "6px 0" }}>
                <span style={{ font: `${r.diff && i > 0 ? 700 : 500} 14px/1.3 var(--mono)`, color: v === "Not stated" ? AMBER : INK, ...clamp2 }} title={v}>{v}</span>
                {r.diff && canChallenge(view, f) && (
                  <button className="om-btn ghost row" aria-label={`Challenge ${view.label}: ${r.label}`} onClick={(e) => { e.stopPropagation(); onChallenge(r.name, view.pipeline); }}>Challenge</button>
                )}
              </span>
            );
          })}
          <span>{r.diff && <span style={{ border: `1.5px solid ${INK}`, padding: "3px 6px", font: "700 11px/1 var(--sans)", letterSpacing: ".05em", textTransform: "uppercase" }}>≠ Differs</span>}</span>
        </div>
      ))}
    </>
  );
}

export function NotStatedCard({ field, selected, onSelect, onQuote, onRequest, onChallenge, operator }: {
  field: NotStated; selected: boolean; onSelect(): void; onQuote(page: number): void;
  /** Absent for a Brand-authored Field: the Brand provides it itself. */
  onRequest?(): void;
  /** Present while it can be Challenged ("the Document does state it"). */
  onChallenge?(): void;
  operator?: string;
}) {
  return (
    <div onClick={onSelect} data-field={field.name} style={{ margin: "6px 20px 14px", border: "1px solid var(--amber-bd)", background: "var(--amber-card)", cursor: "pointer", outline: selected ? `2px solid ${AMBER}` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--hatch)", borderBottom: "1px solid var(--amber-bd)" }}>
        <span style={{ font: "600 15px/1.2 var(--sans)", color: INK }}>{field.label}</span>
        <span style={{ marginLeft: "auto", flex: "none", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px 0 5px", border: `1px solid ${AMBER}`, background: "var(--amber-bg)", color: AMBER, font: "600 11.5px/1 var(--sans)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
          <span aria-hidden style={{ width: 16, height: 16, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: AMBER, color: "var(--amber-bg)", font: "700 10px/1 var(--mono)" }}>–</span>{onRequest ? "Not stated" : "Brand to provide"}
        </span>
      </div>
      <div style={{ padding: "10px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ font: "500 12px/1.3 var(--sans)", color: "#2A2723" }}>
          {field.quotes.length ? "The Sieves found competing statements and no single value:" : "Not stated in this Document."}
        </span>
        {field.quotes.map((q, i) => (
          <div key={i} onClick={(e) => { e.stopPropagation(); onQuote(q.page); }}
            style={{ display: "grid", gridTemplateColumns: "42px minmax(0,1fr)", gap: 10, font: "400 14px/1.45 var(--sans)", color: INK, cursor: "pointer" }}>
            <span style={{ font: "500 12px/1.6 var(--mono)", color: AMBER }}>p. {q.page}</span><span>“{q.quote}”</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: 4 }}>
          <span style={{ marginRight: "auto", font: "500 12px/1.3 var(--sans)", color: "#2A2723" }}>Author: {field.author}</span>
          {onChallenge && <button className="om-btn ghost" aria-label={`Challenge ${operator}: ${field.label}`} style={{ height: 38, padding: "0 14px", fontSize: 13 }} onClick={(e) => { e.stopPropagation(); onChallenge(); }}>Challenge</button>}
          {onRequest
            ? <button className="om-btn primary" style={{ height: 38, padding: "0 14px", fontSize: 13 }} onClick={(e) => { e.stopPropagation(); onRequest(); }}>Copy Supplier Request</button>
            : <span style={{ font: "600 13px/1 var(--sans)", color: AMBER }}>Brand to provide</span>}
        </div>
      </div>
    </div>
  );
}

function SupplierRequest({ text, onClose }: { text: string; onClose(): void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* no clipboard: the text is on screen to select */ }
    setCopied(true);
  };
  return (
    <>
      <pre style={{ margin: 0, padding: "18px 22px", whiteSpace: "pre-wrap", font: "400 14px/1.55 var(--mono)", color: INK, background: "var(--band)" }}>{text}</pre>
      <div style={{ padding: "16px 22px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="om-btn ghost" style={{ height: 42, padding: "0 16px" }} onClick={onClose}>Close</button>
        <button className="om-btn primary" style={{ height: 42, padding: "0 16px" }} onClick={copy}>{copied ? "Copied" : "Copy message"}</button>
      </div>
    </>
  );
}

/** The Challenge form: value, the quote picked on the Document viewer, and the server's answer inline. */
export function ChallengePanel({ operator, field, templateField, closed, slash, deposit, pick, onClearPick, file, onClose }: {
  operator: string; field: Final | NotStated; templateField?: TemplateField; closed?: "settled" | "closed"; slash?: string; deposit?: string;
  pick?: { page: number; quote: string }; onClearPick(): void;
  file(b: Omit<ChallengeBody, "pipeline" | "field">): Promise<unknown>; onClose(): void;
}) {
  const [value, setValue] = useState("");
  const [qualifier, setQualifier] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [filed, setFiled] = useState<{ value: string; page: number }>();
  const final = "evidence" in field ? field : undefined;
  const q = final && splitMark(final.evidence.quote, final.evidence.mark);
  const tf = templateField ?? (final ? { type: typeof final.value === "number" ? "quantity" : typeof final.value === "object" ? "composition" : "text", unit: final.unit, label: field.label } : { type: "text", label: field.label });

  const submit = async () => {
    if (!pick) return setErr("Pick the line on the Document that states the value first.");
    const claim = parseClaim(value, tf);
    if ("error" in claim) return setErr(claim.error);
    setBusy(true);
    try {
      await file({ page: pick.page, quote: pick.quote, ...claim, ...(qualifier && { qualifier }) });
      setFiled({ value: value.trim() + (qualifier ? ` · ${qualifier}` : ""), page: pick.page });
      setErr(undefined);
    } catch (e) {
      const m = e instanceof ApiFailure ? e.message : String(e);
      if (/^quote not found/i.test(m)) {
        setErr(`${m}. Click the table row or sentence that holds the value.`);
        onClearPick();
      } else setErr(m.charAt(0).toUpperCase() + m.slice(1));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SectionLabel>{operator} delivered</SectionLabel>
          <span style={{ font: "600 17px/1.2 var(--sans)" }}>{field.label}</span>
          <span style={{ font: "500 26px/1.1 var(--mono)", overflowWrap: "anywhere", color: final ? INK : AMBER }}>{shown(field)}</span>
          {final && q ? (
            <div style={{ background: "var(--band)", padding: "10px 12px", font: "400 14px/1.5 var(--doc)", display: "grid", gridTemplateColumns: "40px minmax(0,1fr)", gap: 8 }}>
              <span style={{ font: "500 12px/1.6 var(--mono)" }}>p. {final.evidence.page}</span>
              <span>“{q.pre}{q.m && <mark style={{ background: "var(--mark)", fontWeight: 700, padding: "0 2px" }}>{q.m}</mark>}{q.post}”</span>
            </div>
          ) : (
            <span style={{ font: "400 14px/1.5 var(--sans)", color: "#2A2723" }}>If the Document does state it, pick the line that says so and give the value.</span>
          )}
        </div>
        {filed ? (
          <div className="om-motion" style={{ border: `1.5px solid ${RED}`, padding: 16, display: "flex", flexDirection: "column", gap: 10, animation: "om-in .3s ease-out" }}>
            <span style={{ font: "600 17px/1.2 var(--sans)", color: RED }}>Challenge filed</span>
            <span style={{ font: "400 15px/1.5 var(--sans)" }}>
              The Arbiter compares the Document with both values. The Field is marked Challenged until the decision. Your challenged value: <b style={{ font: "600 15px var(--mono)" }}>{filed.value}</b>, p. {filed.page}.
            </span>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <button className="om-btn primary" style={{ height: 42, padding: "0 16px" }} onClick={onClose}>Back to Document</button>
            </div>
          </div>
        ) : closed ? (
          <div style={{ border: `1px solid ${INK}`, padding: 16, font: "400 15px/1.5 var(--sans)" }}>
            <b style={{ fontWeight: 600 }}>The Challenge Window has closed.</b>{" "}
            {closed === "settled"
              ? "This Document has settled, so its Fields can no longer be Challenged. The Bond has been released."
              : "Its Fields can no longer be Challenged. The Bond settles once the Arbiter has decided the open Challenges."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ font: "600 17px/1.2 var(--sans)" }}>What does the Document say?</span>
              <label htmlFor="cv" style={{ font: "500 13px/1 var(--sans)", color: "#2A2723" }}>Value</label>
              <input id="cv" value={value} onChange={(e) => setValue(e.target.value)} placeholder={final ? `e.g. ${shown({ ...final, qualifier: undefined })}` : `e.g. the value on the page${tf.unit ? `, in ${tf.unit}` : ""}`}
                style={{ height: 48, padding: "0 14px", border: `1px solid ${INK}`, background: "#FFFFFF", font: "500 18px/1 var(--mono)", color: INK, outline: "none" }} />
              {templateField?.qualifiers && (
                <>
                  <label htmlFor="cq" style={{ font: "500 13px/1 var(--sans)", color: "#2A2723" }}>Qualifier</label>
                  <select id="cq" value={qualifier} onChange={(e) => setQualifier(e.target.value)}
                    style={{ height: 44, padding: "0 10px", border: `1px solid ${INK}`, background: "#FFFFFF", font: "500 15px/1 var(--mono)", color: INK, borderRadius: 0 }}>
                    <option value="">none</option>
                    {templateField.qualifiers.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </>
              )}
              <span style={{ font: "500 13px/1 var(--sans)", color: "#2A2723", marginTop: 4 }}>Page and quote</span>
              {pick ? (
                <div className="om-motion" style={{ border: `1.5px dashed ${INK}`, padding: "10px 12px", display: "grid", gridTemplateColumns: "40px minmax(0,1fr) auto", gap: 8, alignItems: "start", font: "400 14px/1.5 var(--doc)", animation: "om-in .2s ease-out" }}>
                  <span style={{ font: "500 12px/1.6 var(--mono)" }}>p. {pick.page}</span><span>“{pick.quote}”</span>
                  <button onClick={onClearPick} style={{ border: 0, background: "transparent", font: "500 12px/1.5 var(--sans)", textDecoration: "underline", cursor: "pointer" }}>Change</button>
                </div>
              ) : (
                <div style={{ border: "1.5px dashed #8E877A", padding: 14, font: "400 14px/1.45 var(--sans)", color: "#2A2723", display: "flex", gap: 10 }}>
                  <span style={{ font: "600 14px/1.45 var(--mono)" }}>←</span>Click the region on the Document that states the value. The quote fills in automatically.
                </div>
              )}
              {err && <div role="alert" style={{ border: `1.5px solid ${RED}`, padding: "10px 12px", font: "500 14px/1.45 var(--sans)", color: RED }}>{err}</div>}
            </div>
            <p style={{ margin: 0, font: "400 15px/1.55 var(--sans)", color: "#2A2723" }}>
              The Arbiter compares the Document with both values. If you're right, {slash && <span style={{ fontFamily: "var(--mono)", color: "var(--money)", fontWeight: 600 }}>{slash} USDC</span>} of the Bond is paid to you, and the corrected value replaces the old one.
            </p>
            {deposit && (
              <p style={{ margin: 0, font: "400 14px/1.45 var(--sans)", color: "#2A2723" }}>
                Filing locks a Challenge Deposit of <b style={{ fontFamily: "var(--mono)" }}>{usdc(deposit)} USDC</b>.
                It comes back if the Arbiter upholds the Challenge, and pays the Arbiter if it is rejected.
              </p>
            )}
          </>
        )}
      </div>
      {!filed && !closed && (
        <div style={{ flex: "none", padding: "16px 22px", borderTop: `1px solid ${INK}` }}>
          <button className="om-btn danger" disabled={busy} onClick={submit} style={{ width: "100%", height: 54, fontSize: 17 }}>File Challenge</button>
        </div>
      )}
    </div>
  );
}
