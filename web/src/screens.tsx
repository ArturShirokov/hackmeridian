// Shared screen bits: the page header, the server clock, and the not-found page.
// The screens themselves live in screens/brand/ (ticket 3) and screens/ops/ (ticket 4).
import { useMemo, type ReactNode } from "react";
import { api, usePoll } from "./api.ts";

export function PageHeader({ eyebrow, title, pad = "28px 40px 20px", right }: { eyebrow: string; title: string; pad?: string; right?: ReactNode }) {
  return (
    <div style={{ padding: pad, borderBottom: "1px solid var(--rule)", display: "flex", alignItems: "flex-end", gap: 20 }}>
      <div>
        <div style={{ font: "600 12px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#2A2723" }}>{eyebrow}</div>
        <h1 style={{ margin: "8px 0 0", font: "600 30px/1.1 var(--sans)", letterSpacing: "-0.01em" }}>{title}</h1>
      </div>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}

/** config.now − Date.now(), taken when the config arrives. */
export function useServerClock() {
  const { data } = usePoll(api.config, 60_000);
  const offset = useMemo(() => (data ? data.now - Date.now() : 0), [data]);
  return { config: data, offset };
}

export function NotFound() {
  return <div style={{ flex: 1, overflow: "auto" }}><PageHeader eyebrow="doc2dpp" title="Page not found" /></div>;
}
