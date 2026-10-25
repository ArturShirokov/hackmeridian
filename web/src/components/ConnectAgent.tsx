// "Connect an agent": a button and a three-step modal (agent → role → what to paste plus a starter prompt), then a live
// success line once the agent's first call shows up (a live Worker, or a new Leaderboard row for an outside Operator).
// The MCP URL is always /api/config's baseUrl, so it is local in dev and the public URL in production.
import { useRef, useState } from "react";
import { api, usePoll } from "../api.ts";
import { mcpUrl, setup, starterPrompt, type AgentRole, type Harness } from "../../../src/connect.ts";
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
  const [workerId, setWorkerId] = useState("w1");
  if (!config) return null;
  const url = mcpUrl(config.baseUrl);
  const tools = role === "worker" ? "next_job and submit_job" : "list_open_documents, claim_document, deliver and submit_signed";
  const id = workerId.trim() || "w1";
  return (
    <>
      <SectionLabel>3 · Paste</SectionLabel>
      {setup(harness, url).map((b) => <Copyable key={b.label} label={b.label} text={b.text} />)}
      <span style={{ font: "400 13px/1.45 var(--sans)", color: "#2A2723" }}>Check: ask the session to list its MCP tools. It should show {tools}.</span>
      {role === "worker" && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, font: "500 13px/1 var(--sans)" }}>
          Worker id
          <input aria-label="Worker id" value={workerId} onChange={(e) => setWorkerId(e.target.value)}
            style={{ width: 90, height: 32, border: `1px solid ${INK}`, padding: "0 8px", font: "500 13px/1 var(--mono)" }} />
          <span style={{ font: "400 12.5px/1.3 var(--sans)", color: "#2A2723" }}>one per session</span>
        </label>
      )}
      <Copyable label="Starter prompt" text={role === "worker" ? starterPrompt(workerPrompt, id) : operatorPrompt} prose />
      <Live role={role} workerId={id} />
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

/** The success state: the Worker id live on the Job Board, or a Leaderboard row that was not there when this opened. */
function Live({ role, workerId }: { role: AgentRole; workerId: string }) {
  const { data: workers } = usePoll(() => (role === "worker" ? api.workers() : Promise.resolve([])), 1000, [role]);
  const { data: rows } = usePoll(() => (role === "operator" ? api.leaderboard() : Promise.resolve([])), 1000, [role]);
  const seen = useRef<Set<string>>();
  if (rows && !seen.current && role === "operator") seen.current = new Set(rows.map((r) => r.operator));
  const fresh = role === "operator" && seen.current ? rows?.find((r) => !seen.current!.has(r.operator)) : undefined;
  const ok = role === "worker" ? workers?.some((w) => w.name === workerId && w.live) : !!fresh;
  const msg = ok
    ? role === "worker" ? `${workerId} is connected. It shows as a Worker chip on the Job Board.` : `${fresh!.label} is on the Leaderboard.`
    : role === "worker" ? `Waiting for ${workerId} to call next_job…` : "Waiting for a new Operator to claim a Document…";
  return (
    <div role="status" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", border: `1.5px ${ok ? "solid" : "dashed"} ${ok ? "var(--live)" : "#8E877A"}`, font: "500 13.5px/1.3 var(--sans)" }}>
      <span className="om-motion" style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: ok ? "var(--live)" : "#B5AE9F", animation: ok ? undefined : "om-pulse 1.4s ease-in-out infinite" }} />
      {msg}
    </div>
  );
}
