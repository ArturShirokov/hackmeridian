// Small shared components. Styles copied from the prototype (docs/design/prototype), tokens in tokens.css.
import { useEffect, useState, type CSSProperties, type ButtonHTMLAttributes, type ReactNode } from "react";
import { clock, shortHash, splitMark, usdc } from "../format.ts";

/** At most two lines, then an ellipsis; give the element the full value as its title. */
export const clamp2 = { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", overflowWrap: "anywhere" } as const;

export type BadgeStatus = "final" | "converging" | "not stated" | "challenged" | "upheld" | "rejected" | "queued";

const INK = "#141414", PAPER = "#F7F5F0", RED = "#A3221B";
const DOTS = "radial-gradient(circle,#3D3A34 0.9px,transparent 1.4px)";
/** The prototype's `B` table, verbatim. */
export const BADGE: Record<BadgeStatus, { label: string; icon: string; fg: string; bg: string; bd: string; ib: string; ic: string; ibs: string; ibd: string; ul: string; anim: string; td: string }> = {
  final: { label: "Final", icon: "✓", fg: INK, bg: "transparent", bd: "transparent", ib: INK, ic: PAPER, ibs: "solid", ibd: INK, ul: "none", anim: "none", td: "none" },
  converging: { label: "Converging", icon: "", fg: "#3D3A34", bg: "transparent", bd: "transparent", ib: "transparent", ic: INK, ibs: "dotted", ibd: "#3D3A34", ul: DOTS, anim: "om-dots .8s linear infinite", td: "none" },
  "not stated": { label: "Not stated", icon: "–", fg: "#6B4400", bg: "var(--hatch)", bd: "#B9862A", ib: "#6B4400", ic: "#FBF3E0", ibs: "solid", ibd: "#6B4400", ul: "none", anim: "none", td: "none" },
  challenged: { label: "Challenged", icon: "!", fg: RED, bg: "#FFFDF9", bd: RED, ib: "transparent", ic: RED, ibs: "solid", ibd: RED, ul: "none", anim: "none", td: "none" },
  upheld: { label: "Upheld", icon: "!", fg: "#FFFFFF", bg: RED, bd: RED, ib: "#FFFFFF", ic: RED, ibs: "solid", ibd: "#FFFFFF", ul: "none", anim: "none", td: "none" },
  rejected: { label: "Rejected", icon: "×", fg: "#5E594F", bg: "transparent", bd: "#BDB6A7", ib: "transparent", ic: "#5E594F", ibs: "solid", ibd: "#8E877A", ul: "none", anim: "none", td: "line-through" },
  queued: { label: "Queued", icon: "", fg: "#5E594F", bg: "transparent", bd: "transparent", ib: "transparent", ic: INK, ibs: "solid", ibd: "#C9C1B0", ul: "none", anim: "none", td: "none" },
};

export function StatusBadge({ status, size = "sm" }: { status: BadgeStatus; size?: "sm" | "md" }) {
  const b = BADGE[status];
  return (
    <span
      data-status={status}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, height: 26, padding: "0 9px 0 5px", border: `1px solid ${b.bd}`, background: b.bg, color: b.fg,
        font: `600 ${size === "md" ? 11.5 : 11}px/1 var(--sans)`, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap", justifySelf: "start", flex: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 16, height: 16, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", background: b.ib, color: b.ic,
          border: `1.5px ${b.ibs} ${b.ibd}`, font: "700 10px/1 var(--mono)",
        }}
      >
        {b.icon}
      </span>
      <span
        className="om-motion"
        style={{
          paddingBottom: 3, marginBottom: -3, backgroundImage: b.ul, backgroundSize: "5px 2px", backgroundRepeat: "repeat-x", backgroundPosition: "0 100%",
          animation: b.anim, textDecoration: b.td,
        }}
      >
        {b.label}
      </span>
    </span>
  );
}

export function TieBreakTag({ small }: { small?: boolean }) {
  return (
    <span
      style={{
        alignSelf: "flex-start", border: `1px solid ${small ? "#8E877A" : INK}`, padding: small ? "2px 5px" : "3px 6px",
        font: `600 ${small ? 9.5 : 10.5}px/1 var(--sans)`, letterSpacing: ".05em", textTransform: "uppercase", color: small ? "#2A2723" : INK,
      }}
    >
      Tie-break
    </span>
  );
}

/** A quote with the value's words in <mark> (first case-insensitive match of `mark`). */
export function Quote({ page, quote, mark, style }: { page: number; quote: string; mark?: string; style?: CSSProperties }) {
  const q = splitMark(quote, mark);
  return (
    <span style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: 10, ...style }}>
      <span style={{ font: "500 12px/1.6 var(--mono)", color: "#2A2723" }}>p. {page} quote</span>
      <span style={{ font: "400 14px/1.55 var(--doc)", color: "#1E1E1E" }}>
        “{q.pre}
        {q.m && <mark style={{ background: "var(--mark)", color: INK, fontWeight: 700, padding: "0 2px", boxShadow: `inset 0 -2px 0 ${INK}` }}>{q.m}</mark>}
        {q.post}”
      </span>
    </span>
  );
}

export function MoneyChip({ label, amount, state, split, tone }: {
  label: string; amount: string; state: "locked" | "released" | "slashed" | "held" | "paid"; split?: string; tone: "bond" | "fee";
}) {
  const bd = tone === "fee" ? "var(--money-soft)" : state === "slashed" ? RED : "var(--money)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, border: `1px solid ${bd}`, padding: "7px 11px", color: "var(--money)", background: tone === "fee" ? "transparent" : "var(--surface)" }}>
      <SectionLabel size={10.5}>{label}</SectionLabel>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
        <b style={{ font: "600 21px/1 var(--mono)" }}>{usdc(amount)}</b>
        <span style={{ font: "500 12px/1 var(--mono)" }}>USDC · {state}</span>
      </span>
      {split && <span style={{ font: "500 11.5px/1 var(--mono)", color: RED }}>{split}</span>}
    </div>
  );
}

/** "View on Stellar ↗ a3f9…c21e"; nothing without a link. */
export function ProofLink({ href, hash, label = "View on Stellar", color }: { href?: string; hash: string; label?: string; color?: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noopener" style={{ font: "500 12px/1 var(--mono)", color: color ?? "var(--money)", whiteSpace: "nowrap" }}>
      {label} ↗ {shortHash(hash)}
    </a>
  );
}

const PAUSED = { "until opened": "starts when the Document is opened", "challenge open": "paused while a Challenge is open" } as const;

/**
 * Time left in the Challenge Window. serverOffsetMs = config.now − Date.now() when config was read.
 * While `paused`, it holds msLeft. note: "3 min demo · 48 h live".
 */
export function Countdown({ closesAt, msLeft, paused, windowMs, serverOffsetMs, settled, bare, note }: {
  closesAt: number; msLeft?: number; paused?: keyof typeof PAUSED; windowMs: number; serverOffsetMs: number; settled: boolean; bare?: boolean; note?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (settled) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [settled]);
  const left = settled ? 0 : paused && msLeft !== undefined ? msLeft : Math.max(0, closesAt - (now + serverOffsetMs));
  const text = <span style={{ font: `500 ${bare ? 17 : 21}px/1 var(--mono)`, color: settled ? "#5E594F" : INK }}>{clock(left)}</span>;
  const why = !settled && paused && <span style={{ font: "500 11.5px/1.2 var(--sans)", color: "#3D3A34", whiteSpace: "nowrap" }}>{PAUSED[paused]}</span>;
  if (bare) return <>{text}{why && <> {why}</>}</>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 150 }}>
      <SectionLabel size={10.5}>Challenge Window</SectionLabel>
      {text}
      <div style={{ height: 2, background: "var(--track)" }}>
        <div style={{ height: 2, background: INK, width: `${windowMs ? (left / windowMs) * 100 : 0}%` }} />
      </div>
      {why}
      {note && <span style={{ font: "500 11.5px/1 var(--mono)", color: "#3D3A34", whiteSpace: "nowrap" }}>{note}</span>}
    </div>
  );
}

/** A Worker: name with a live dot (pulsing while it runs a Job); `job` adds "Sieve · Document". */
export function WorkerChip({ name, live, running, job }: { name: string; live: boolean; running: boolean; job?: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start", border: "1px solid var(--rule)", padding: "4px 7px", font: "500 12px/1 var(--sans)", background: PAPER }}>
      <span
        className="om-motion"
        style={{ width: 7, height: 7, borderRadius: "50%", background: running ? "var(--live)" : live ? "#6E685D" : "#B5AE9F", animation: running ? "om-pulse 1s ease-in-out infinite" : "none" }}
      />
      {name}
      {job && <span style={{ font: "500 12px/1 var(--mono)", color: "#2A2723" }}>· {job}</span>}
    </span>
  );
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger"; size?: "lg" | "md" | "sm" | "row";
}) {
  return <button className={`om-btn ${variant} ${size} ${className ?? ""}`} {...rest} />;
}

export function SectionLabel({ children, color = "#2A2723", size = 11 }: { children: ReactNode; color?: string; size?: number }) {
  return <span style={{ font: `600 ${size}px/1 var(--sans)`, letterSpacing: ".07em", textTransform: "uppercase", color }}>{children}</span>;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="om-motion"
      role="progressbar"
      style={{ width: size, height: size, flex: "none", border: "2px solid var(--rule)", borderTopColor: INK, borderRadius: "50%", animation: "om-spin .8s linear infinite", display: "inline-block" }}
    />
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: ReactNode }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "var(--overlay)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
      <div role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()} className="om-motion"
        style={{ width: 560, maxWidth: "calc(100vw - 32px)", background: "var(--surface)", border: `1px solid ${INK}`, animation: "om-in .2s ease-out" }}>
        <div style={{ padding: "18px 22px", borderBottom: "1px solid var(--rule)", font: "600 18px/1 var(--sans)" }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Slides over its positioned parent (the Review's right column). */
export function SidePanel({ open, onClose, title, children }: { open: boolean; onClose(): void; title: string; children: ReactNode }) {
  useEscape(open, onClose);
  return (
    <div aria-hidden={!open} className="om-motion"
      style={{
        position: "absolute", inset: 0, background: "var(--surface)", borderLeft: `1px solid ${INK}`, display: "flex", flexDirection: "column", zIndex: 4,
        transform: open ? "translateX(0)" : "translateX(102%)", transition: "transform .32s cubic-bezier(.3,.7,.2,1), visibility .32s", boxShadow: "-12px 0 24px rgba(20,20,20,.08)",
        visibility: open ? "visible" : "hidden",
      }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", padding: "16px 22px", borderBottom: `1px solid ${INK}` }}>
        <span style={{ font: "600 19px/1 var(--sans)" }}>{title}</span>
        <button onClick={onClose} aria-label="Close"
          style={{ marginLeft: "auto", width: 36, height: 36, border: "1px solid var(--rule)", background: "transparent", font: "500 18px/1 var(--sans)", cursor: "pointer" }}>×</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</div>
    </div>
  );
}
