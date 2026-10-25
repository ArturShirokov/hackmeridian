// Bits shared by the Arbiter desk, Leaderboard and Job Board.
import { useEffect, useState } from "react";
import { Spinner } from "../../components/ui.tsx";

/** The server's clock (Date.now() + offset), ticking every second. */
export function useNow(offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + offset;
}

export function Loading({ error, text = "Loading…", pad = "28px 40px" }: { error?: Error; text?: string; pad?: string }) {
  return (
    <div style={{ padding: pad, display: "flex", alignItems: "center", gap: 12, font: "500 15px/1 var(--sans)", color: error ? "#A3221B" : "var(--ink)" }}>
      {error ? error.message : <><Spinner />{text}</>}
    </div>
  );
}

export const th = { font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" } as const;

/** The last path segment of an explorer link, for ProofLink's short hash. */
export const tail = (href?: string) => href?.split(/[/?#]/).filter(Boolean).pop() ?? "";
