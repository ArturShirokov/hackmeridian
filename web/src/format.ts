// Display helpers shared by every screen.

/** Milliseconds as hh:mm:ss (hours may pass 24), clamped at zero. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((v) => String(v).padStart(2, "0")).join(":");
}

/** "a3f9…c21e". */
export const shortHash = (h: string) => (h.length > 10 ? `${h.slice(0, 4)}…${h.slice(-4)}` : h);

/** Split a quote around the first case-insensitive match of `mark`, for a <mark>. */
export function splitMark(quote: string, mark?: string) {
  const i = mark ? quote.toLowerCase().indexOf(mark.toLowerCase()) : -1;
  if (i < 0) return { pre: quote, m: "", post: "" };
  return { pre: quote.slice(0, i), m: quote.slice(i, i + mark!.length), post: quote.slice(i + mark!.length) };
}

/** A USDC decimal string with two decimals. */
export const usdc = (v: string) => Number(v).toFixed(2);
