// One Field: the Review row (click to select, expand for the quote, Challenge button) or the dense Pipeline/mobile row.
import type { ReactNode } from "react";
import type { ApiChallengeSummary, ApiField } from "../api.ts";
import { Button, clamp2, Quote, StatusBadge, TieBreakTag, type BadgeStatus } from "./ui.tsx";

/** The badge a Field shows: its Challenge's state wins over its own status. */
export function badgeFor(field: ApiField, challenge?: ApiChallengeSummary): BadgeStatus {
  if (challenge) return challenge.status === "filed" ? "challenged" : challenge.status;
  return field.status;
}

/** The value text: never a value while converging or withheld (Sieve independence). */
export function valueOf(field: ApiField): { text: string; color: string } {
  if ("withheld" in field || field.status === "converging") return { text: "· · ·", color: "#3D3A34" };
  if (field.status === "not stated") return { text: "—", color: "#6B4400" };
  return { text: field.display, color: "#141414" };
}

/** What an expanded row without a quote says. */
const unquoted = (f: ApiField) =>
  "withheld" in f ? "Shown once every Operator has delivered this Document." : f.status === "converging" ? "Still converging" : "Not stated in this Document.";

export function pageOf(field: ApiField): number | undefined {
  if ("evidence" in field) return field.evidence.page;
  if ("quotes" in field) return field.quotes[0]?.page;
}

export function FieldRow({ field, challenge = field.challenge, selected, expanded, tieBreak, canChallenge, onSelect, onToggle, onChallenge, dense, upheldNote }: {
  field: ApiField; challenge?: ApiChallengeSummary; selected: boolean; expanded: boolean; tieBreak: boolean; canChallenge: boolean;
  onSelect(): void; onToggle(): void; onChallenge(): void; dense?: boolean;
  /** Under an upheld row: "Slash 5.00 USDC paid to Voltaris when the Window closes" + link. */
  upheldNote?: ReactNode;
}) {
  const badge = badgeFor(field, challenge);
  const v = valueOf(field);
  const page = pageOf(field);
  const pageLbl = page ? `p. ${page}` : "";

  if (dense)
    return (
      <div className="om-motion"
        style={{
          display: "grid", gridTemplateColumns: "260px minmax(0,1fr) 170px 70px 110px", gap: 16, alignItems: "center", padding: "0 32px", height: 48,
          borderBottom: "1px solid var(--rule-row)", background: field.status === "not stated" ? "var(--amber-bg)" : "transparent", transition: "background .4s",
        }}>
        <span style={{ font: "500 15px/1.2 var(--sans)" }}>{field.label}</span>
        <span title={v.text} style={{ font: "500 15px/1.2 var(--mono)", color: v.color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.text}</span>
        <StatusBadge status={badge} size="md" />
        <span style={{ font: "500 13px/1 var(--mono)", color: "#3D3A34" }}>{pageLbl}</span>
        <span>{tieBreak && <TieBreakTag />}</span>
      </div>
    );

  const final = "evidence" in field ? field : undefined;
  return (
    <div data-field={field.name}
      style={{ borderBottom: "1px solid var(--rule-row)", background: selected ? "var(--row-selected)" : "transparent", outline: badge === "challenged" ? "1.5px solid #A3221B" : "none", outlineOffset: -2 }}>
      <div onClick={() => (selected ? onToggle() : onSelect())}
        style={{ display: "grid", gridTemplateColumns: "minmax(0,1.8fr) minmax(0,1fr) 120px 34px 88px", alignItems: "center", gap: 8, padding: "0 16px", minHeight: 52, cursor: "pointer" }}>
        <span style={{ font: "500 14.5px/1.25 var(--sans)", display: "flex", flexDirection: "column", gap: 3 }}>
          {field.label}
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {field.author && <span data-author style={{ font: "500 11px/1 var(--mono)", color: "#3D3A34", border: "1px solid var(--rule)", padding: "2px 5px" }}>{field.author}</span>}
            {tieBreak && <TieBreakTag small />}
          </span>
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          {badge === "upheld" && final?.corrected && <span title={final.corrected.was} style={{ font: "500 13px/1.2 var(--mono)", color: "#5E594F", textDecoration: "line-through", ...clamp2 }}>{final.corrected.was}</span>}
          <span title={v.text} style={{ font: "500 15px/1.25 var(--mono)", color: v.color, ...clamp2 }}>{v.text}</span>
          {badge === "rejected" && challenge && (
            <span style={{ font: "500 12px/1.2 var(--mono)", color: "#5E594F" }}>
              <span style={{ textDecoration: "line-through" }}>{challenge.value}</span> challenge rejected
            </span>
          )}
        </span>
        <StatusBadge status={badge} />
        <span style={{ font: "500 12.5px/1 var(--mono)", color: "#2A2723" }}>{pageLbl}</span>
        <span style={{ textAlign: "right" }}>
          {canChallenge && (
            <Button variant="ghost" size="row" onClick={(e) => { e.stopPropagation(); onChallenge(); }}>Challenge</Button>
          )}
        </span>
      </div>
      {expanded && (
        <div className="om-motion" style={{ padding: "0 20px 14px", animation: "om-in .2s ease-out" }}>
          {final ? (
            <>
              <Quote page={final.evidence.page} quote={final.evidence.quote} mark={final.evidence.mark} style={{ borderTop: "1px dashed #B5AE9F", paddingTop: 10 }} />
              {!final.evidence.rects.length && <div style={{ marginTop: 6, font: "500 12px/1.3 var(--mono)", color: "#5E594F" }}>quote not found in the PDF text (scan)</div>}
            </>
          ) : (
            <div style={{ borderTop: "1px dashed #B5AE9F", paddingTop: 10, font: "500 13px/1.4 var(--sans)", color: "#3D3A34" }}>{unquoted(field)}</div>
          )}
        </div>
      )}
      {badge === "challenged" && challenge && (
        <div style={{ padding: "0 20px 12px", font: "600 13px/1.3 var(--sans)", color: "#A3221B" }}>
          Under review by Arbiter · challenged value <span style={{ fontFamily: "var(--mono)" }}>{challenge.value}</span>
        </div>
      )}
      {badge === "upheld" && upheldNote && (
        <div style={{ padding: "0 20px 12px", display: "flex", alignItems: "center", gap: 14, font: "600 13px/1.3 var(--mono)", color: "var(--money)" }}>{upheldNote}</div>
      )}
    </div>
  );
}
