// "Connect an agent": a button and a three-step modal (agent → role → what to paste plus a starter prompt), then a live
// success line once the agent's first call shows up (a live Worker, or a new Leaderboard row for an outside Operator).
// The MCP URL is always /api/config's baseUrl, so it is local in dev and the public URL in production.
import { useRef, useState } from "react";
import { api, usePoll, type ApiWorker } from "../api.ts";
import { mcpUrl, setup, type AgentRole, type Harness } from "../../../src/connect.ts";
import { useServerClock } from "../screens.tsx";
import { Button, Modal, SectionLabel } from "./ui.tsx";
import workerPrompt from "../../../agents/worker-prompt.md?raw";
import operatorPrompt from "../../../agents/operator-prompt.md?raw";

const INK = "#141414";
const HARNESSES: [Harness, string][] = [["claude-code", "Claude Code"], ["opencode", "OpenCode"], ["pi", "Pi"], ["other", "Other MCP client"]];
const ROLES: [AgentRole, string, string][] = [
  ["worker", "Worker in our Pipeline", "Takes Jobs with next_job and hands them in with submit_job. No wallet."],
  ["operator", "An outside Operator", "Claims whole Documents with claim_document, delivers with deliver, locks its own Bond from its own Stellar testnet wallet."],
];
const choice = { width: "100%", textAlign: "left", border: `1px solid ${INK}`, background: "transparent", padding: "12px 14px", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4 } as const;

export function ConnectAgent({ variant = "primary" }: { variant?: "primary" | "ghost" }) {
  const [open, setOpen] = useState(false);
  const [harness, setHarness] = useState<Harness>();
  const [role, setRole] = useState<AgentRole>();
  const close = () => { setOpen(false); setHarness(undefined); setRole(undefined); };
  return (
    <>
      <Button variant={variant} size="sm" onClick={() => setOpen(true)} style={{ fontWeight: 600 }}>Connect an agent</Button>
      <Modal open={open} onClose={close} title="Connect an agent">
        <div style={{ padding: "18px 22px 22px", display: "flex", flexDirection: "column", gap: 12, maxHeight: "75vh", overflow: "auto" }}>
          {!harness ? (
            <>
              <SectionLabel>1 · Agent</SectionLabel>
              {HARNESSES.map(([h, label]) => (
                <button key={h} style={choice} onClick={() => setHarness(h)}><span style={{ font: "600 15px/1.2 var(--sans)" }}>{label}</span></button>
              ))}
            </>
          ) : !role ? (
            <>
              <SectionLabel>2 · Role</SectionLabel>
              {ROLES.map(([r, label, sub]) => (
                <button key={r} style={choice} onClick={() => setRole(r)}>
                  <span style={{ font: "600 15px/1.2 var(--sans)" }}>{label}</span>
                  <span style={{ font: "400 13px/1.4 var(--sans)", color: "#2A2723" }}>{sub}</span>
                </button>
              ))}
              <Back onClick={() => setHarness(undefined)} />
            </>
          ) : (
            <Paste harness={harness} role={role} onBack={() => setRole(undefined)} />
          )}
        </div>
      </Modal>
    </>
  );
}

const Back = ({ onClick }: { onClick(): void }) => <Button variant="ghost" size="sm" onClick={onClick} style={{ alignSelf: "flex-start" }}>Back</Button>;

function Paste({ harness, role, onBack }: { harness: Harness; role: AgentRole; onBack(): void }) {
  const { config } = useServerClock();
  if (!config) return null;
  const url = mcpUrl(config.baseUrl);
  const tools = role === "worker" ? "register_worker, next_job and submit_job" : "list_open_documents, claim_document, deliver and submit_signed";
  return (
    <>
      <SectionLabel>3 · Paste</SectionLabel>
      {setup(harness, url).map((b) => <Copyable key={b.label} label={b.label} text={b.text} />)}
      <span style={{ font: "400 13px/1.45 var(--sans)", color: "#2A2723" }}>Check: ask the session to list its MCP tools. It should show {tools}.</span>
      <Copyable label="Starter prompt" text={role === "worker" ? workerPrompt : operatorPrompt} prose />
      {role === "worker" && <span style={{ font: "400 12.5px/1.4 var(--sans)", color: "#2A2723" }}>The Job Board gives each session its own Worker id when it calls register_worker; paste the same prompt into every session.</span>}
      <Live role={role} />
      <Back onClick={onBack} />
    </>
  );
}

function Copyable({ label, text, prose }: { label: string; text: string; prose?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ font: "500 13px/1.3 var(--sans)" }}>{label}</span>
        <Button variant="ghost" size="row" onClick={copy} style={{ marginLeft: "auto" }}>{copied ? "Copied" : "Copy"}</Button>
      </div>
      <pre aria-label={label} style={{ margin: 0, padding: 12, background: INK, color: "var(--paper)", font: `400 ${prose ? 12 : 12.5}px/1.55 var(--mono)`, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: prose ? 220 : undefined, overflow: "auto" }}>{text}</pre>
    </div>
  );
}

/** The success state: a live Worker, or a Leaderboard row, that was not there when this opened. */
function Live({ role }: { role: AgentRole }) {
  const { data: workers } = usePoll(() => (role === "worker" ? api.workers() : Promise.resolve([])), 1000, [role]);
  const { data: rows } = usePoll(() => (role === "operator" ? api.leaderboard() : Promise.resolve([])), 1000, [role]);
  const seen = useRef<Set<string>>();
  const ids = role === "worker" ? workers?.filter((w) => w.live).map((w) => w.name) : rows?.map((r) => r.operator);
  if (ids && !seen.current) seen.current = new Set(ids);
  const newWorker = role === "worker" && seen.current ? workers?.find((w) => w.live && !seen.current!.has(w.name)) : undefined;
  const fresh = role === "operator" && seen.current ? rows?.find((r) => !seen.current!.has(r.operator)) : undefined;
  const ok = !!newWorker || !!fresh;
  const msg = newWorker
    ? `${workerName(newWorker)} is connected. It shows as a Worker chip on the Job Board.`
    : fresh ? `${fresh.label} is on the Leaderboard.`
    : role === "worker" ? "Waiting for a new Worker to call register_worker…" : "Waiting for a new Operator to claim a Document…";
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: `1.5px ${ok ? "solid" : "dashed"} ${ok ? "var(--live)" : "#8E877A"}`, font: "500 13.5px/1.3 var(--sans)" }}>
      <span className="om-motion" style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: ok ? "var(--live)" : "#B5AE9F", animation: ok ? undefined : "om-pulse 1.4s ease-in-out infinite" }} />
      {msg}
    </div>
  );
}

/** "w3 · OpenCode" (plus its label, if it gave one), or the bare id for a Worker that never registered. */
export const workerName = (w: Pick<ApiWorker, "name" | "harness" | "label">) => [w.name, w.harness, w.label].filter(Boolean).join(" · ");
