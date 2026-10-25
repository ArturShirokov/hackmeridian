// Brand: drop a Supplier Document, pick its Template and Supplier, see the terms, Start.
import { useRef, useState, type DragEvent } from "react";
import { api, usePoll, type ApiFailure } from "../../api.ts";
import { navigate } from "../../router.tsx";
import { usdc } from "../../format.ts";
import { useServerClock } from "../../screens.tsx";
import { suggestions, windowLabel } from "./derive.ts";

const INK = "#141414", RED = "#A3221B";
type Phase = "idle" | "wrong" | "failed" | "uploading" | "stored";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.?$/, ".");

export function BrandUpload() {
  const { data: templates } = usePoll(api.templates, 60_000);
  const { data: docs } = usePoll(api.documents, 5000);
  const { config } = useServerClock();
  const [file, setFile] = useState<File>();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [failure, setFailure] = useState("");
  const [tpl, setTpl] = useState("battery");
  const [supplier, setSupplier] = useState("");
  const [focus, setFocus] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const choose = (f?: File) => {
    if (!f) return;
    setFile(f);
    setPhase(/\.pdf$/i.test(f.name) ? "idle" : "wrong");
  };
  const clear = () => { setFile(undefined); setPhase("idle"); if (input.current) input.current.value = ""; };
  const canStart = !!file && (phase === "idle" || phase === "failed");
  const start = async () => {
    if (!canStart) return;
    setPhase("uploading");
    setPct(0);
    let at = 0;
    try {
      const { id } = await api.upload(file!, tpl, supplier.trim(), (p) => setPct((at = Math.round(p * 100))));
      setPhase("stored");
      setTimeout(() => navigate(`/documents/${id}/pipeline`), 1100);
    } catch (e) {
      const err = e as ApiFailure;
      setFailure(`${err.status === 0 ? `The connection dropped at ${at} %.` : sentence(err.message)} The Document was not stored and no Fee was charged.`);
      setPhase("failed");
    }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files?.[0]); };

  const t = templates?.find((x) => x.name === tpl);
  const terms = config?.operators[0];
  const sugg = suggestions(docs ?? [], supplier);
  const zoneBd = drag ? INK : phase === "wrong" || phase === "failed" ? RED : "#8E877A";
  const ext = file?.name.match(/\.[^.]+$/)?.[0]?.toLowerCase() ?? "file of another type";

  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <div style={{ padding: "36px 48px 20px", borderBottom: "1px solid var(--rule)" }}>
        <div style={{ font: "600 12px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#3D3A34" }}>Upload</div>
        <h1 style={{ margin: "10px 0 0", font: "600 32px/1.1 var(--sans)", letterSpacing: "-0.01em" }}>New Supplier Document</h1>
      </div>
      <input ref={input} type="file" accept=".pdf,application/pdf,.docx" hidden onChange={(e) => choose(e.target.files?.[0])} data-testid="file" />
      <div style={{ padding: "32px 48px 48px", display: "grid", gridTemplateColumns: "minmax(0,3fr) minmax(320px,2fr)", gap: 40, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
            style={{ minHeight: 300, border: `1.5px dashed ${zoneBd}`, background: drag ? "#ECE7DB" : "var(--surface)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32, textAlign: "center" }}>
            {!file && phase === "idle" && (
              <>
                <div style={{ font: "600 28px/1.15 var(--sans)" }}>Drop a Supplier Document</div>
                <div style={{ font: "400 15px/1.4 var(--sans)", color: "#3D3A34" }}>
                  PDF, up to 50 MB · <span style={{ fontFamily: "var(--mono)", fontSize: 13, border: "1px solid #B5AE9F", padding: "2px 6px" }}>DOCX</span> coming soon
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
                  <button className="om-btn primary md" onClick={() => input.current?.click()}>Choose a Document</button>
                </div>
              </>
            )}
            {file && phase === "idle" && (
              <>
                <div style={{ width: 56, height: 72, border: `1px solid ${INK}`, background: "#FFFFFF", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 8, font: "600 11px/1 var(--mono)" }}>PDF</div>
                <div style={{ font: "500 18px/1.3 var(--mono)", overflowWrap: "anywhere" }}>{file.name}</div>
                <div style={{ font: "400 14px/1.3 var(--sans)", color: "#3D3A34" }}>{file.size < 1048576 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / 1048576).toFixed(1)} MB`} · PDF</div>
                <button onClick={clear} style={{ height: 36, padding: "0 14px", background: "transparent", border: "1px solid #8E877A", font: "500 13px/1 var(--sans)", cursor: "pointer" }}>Replace</button>
              </>
            )}
            {phase === "wrong" && (
              <>
                <div style={{ font: "600 22px/1.2 var(--sans)", color: RED }}>This Document is a {ext}</div>
                <div style={{ font: "400 15px/1.5 var(--sans)", color: "#2A2723", maxWidth: 440 }}>Only PDF for now. DOCX is coming soon. Export it as PDF from your editor and drop it again.</div>
                <div style={{ font: "500 13px/1 var(--mono)", color: "#3D3A34" }}>{file?.name}</div>
                <button className="om-btn primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }} onClick={clear}>Choose another Document</button>
              </>
            )}
            {phase === "failed" && (
              <>
                <div style={{ font: "600 22px/1.2 var(--sans)", color: RED }}>Upload failed</div>
                <div style={{ font: "400 15px/1.5 var(--sans)", color: "#2A2723", maxWidth: 440 }}>{failure}</div>
                <button className="om-btn primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }} onClick={start}>Try again</button>
              </>
            )}
            {phase === "uploading" && (
              <>
                <div style={{ font: "500 16px/1.3 var(--mono)" }}>{file?.name}</div>
                <div style={{ width: "100%", maxWidth: 440, height: 6, background: "#E2DCCE" }}>
                  <div className="om-motion" style={{ height: 6, background: INK, width: `${pct}%`, transition: "width .1s linear" }} />
                </div>
                <div style={{ font: "500 14px/1 var(--mono)", color: "#3D3A34" }}>Uploading · {pct}%</div>
              </>
            )}
            {phase === "stored" && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, font: "600 22px/1.2 var(--sans)" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: INK, color: "var(--paper)", display: "inline-flex", alignItems: "center", justifyContent: "center", font: "700 12px/1 var(--mono)" }}>✓</span>
                  Document stored
                </div>
                <div style={{ font: "500 14px/1.3 var(--mono)" }}>{file?.name}</div>
              </>
            )}
          </div>

          <div>
            <div style={{ font: "600 15px/1 var(--sans)", marginBottom: 12 }}>Template</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              {(templates ?? []).map((x) => {
                const on = x.name === tpl;
                return (
                  <button key={x.name} onClick={() => setTpl(x.name)} aria-pressed={on}
                    style={{ textAlign: "left", padding: "18px 20px", border: `${on ? 2 : 1}px solid ${on ? INK : "#D6CFBF"}`, background: on ? "var(--surface)" : "transparent", cursor: "pointer", display: "flex", flexDirection: "column", gap: 12, color: INK }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", width: "100%" }}>
                      <span style={{ font: "600 18px/1 var(--sans)" }}>{x.label}</span>
                      <span style={{ font: "500 13px/1 var(--mono)", color: "#3D3A34" }}>{x.fields.length} Fields</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, font: "400 13px/1.3 var(--mono)", color: "#3D3A34" }}>
                      {x.examples.map((label) => {
                        const unit = x.fields.find((f) => f.label === label)?.unit;
                        return <span key={label}>{label}{unit ? ` · ${unit}` : ""}</span>;
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ position: "relative", maxWidth: 520 }}>
            <label htmlFor="sup" style={{ display: "block", font: "600 15px/1 var(--sans)", marginBottom: 10 }}>Supplier</label>
            <input id="sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder="Supplier name" autoComplete="off"
              style={{ width: "100%", height: 46, padding: "0 14px", border: `1px solid ${INK}`, background: "var(--surface)", font: "400 16px/1 var(--sans)", color: INK, outline: "none" }} />
            {focus && sugg.length > 0 && (
              <div style={{ position: "absolute", left: 0, right: 0, top: 78, background: "var(--surface)", border: `1px solid ${INK}`, borderTop: 0, zIndex: 5 }}>
                <div style={{ padding: "8px 14px 4px", font: "500 11px/1 var(--sans)", color: "#3D3A34", letterSpacing: ".06em", textTransform: "uppercase" }}>From past uploads</div>
                {sugg.map((g) => (
                  <div key={g.name} className="om-sugg" onMouseDown={(e) => { e.preventDefault(); setSupplier(g.name); setFocus(false); }}
                    style={{ padding: "10px 14px", font: "400 15px/1.2 var(--sans)", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                    <span>{g.name}</span><span style={{ font: "400 12px/1.2 var(--mono)", color: "#3D3A34" }}>{g.meta}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ border: `1px solid ${INK}`, background: "var(--surface)", position: "sticky", top: 24 }}>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--rule)", font: "600 15px/1 var(--sans)" }}>Summary</div>
          <div style={{ padding: "6px 20px" }}>
            {([
              ["Document", file && phase !== "wrong" ? file.name : "—", true],
              ["Template", t ? `${t.label} passport · ${t.fields.length} Fields` : "—", false],
              ["Supplier", supplier.trim() || "—", false],
            ] as const).map(([k, v, mono], i) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: i < 2 ? "1px solid var(--rule-row)" : 0, font: "400 14px/1.35 var(--sans)" }}>
                <span style={{ color: "#3D3A34" }}>{k}</span>
                <span style={{ textAlign: "right", overflowWrap: "anywhere", ...(mono && { fontFamily: "var(--mono)", fontSize: 13 }) }}>{v}</span>
              </div>
            ))}
          </div>
          {terms && config && (
            <div style={{ padding: "16px 20px", borderTop: "1px solid var(--rule)", background: "var(--band)", font: "500 15px/1.6 var(--mono)", color: INK }}>
              Fee <span style={{ color: "var(--money)", fontWeight: 600 }}>{usdc(terms.fee)} USDC</span> · backed by a <span style={{ color: "var(--money)", fontWeight: 600 }}>{usdc(terms.bond)} USDC</span> Bond · Challenge Window {windowLabel(config)}
            </div>
          )}
          <div style={{ padding: 20 }}>
            <button onClick={start} disabled={!canStart}
              style={{ width: "100%", height: 54, background: canStart ? INK : "#8E877A", color: "var(--paper)", border: 0, font: "600 17px/1 var(--sans)", cursor: canStart ? "pointer" : "not-allowed" }}>Start</button>
            <div style={{ marginTop: 10, font: "400 13px/1.4 var(--sans)", color: "#3D3A34" }}>
              {canStart || phase === "uploading" || phase === "stored" ? "The Pipeline starts as soon as the Document is stored." : "Choose a PDF Document to start."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
