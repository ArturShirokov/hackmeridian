// The shift runner: one process keeps several Workers on shift on the Job Board, each a headless AI harness on its
// own model. Each Worker registers, long-polls next_job, and only when a Job comes runs its harness once on it
// (Job in job.json, the PDF in document.pdf, JSON result on stdout), then hands the result in with submit_job.
// The runner is the MCP client; the harnesses need no MCP config.
//   npx tsx scripts/shift.ts [--url http://127.0.0.1:3100]     (or DOC2DPP_URL; Ctrl-C ends the shift)
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Job } from "../src/board.js";

export interface WorkerConfig {
  /** claude, opencode or pi; any other name needs `command`. */
  harness: string;
  model: string;
  /** Run this instead of the harness's own command; the prompt is appended as the last argument. */
  command?: string[];
}

// The shift. Edit the models here. Names checked on 25 Oct 2026 with `opencode models` and `pi --list-models`.
export const defaultWorkers: WorkerConfig[] = [
  { harness: "claude", model: "sonnet" }, // claude-sonnet: Claude Code's alias for the latest Sonnet
  { harness: "opencode", model: "opencode-go/kimi-k3" },
  { harness: "opencode", model: "opencode-go/deepseek-v4-pro" },
  { harness: "pi", model: "opencode-go/qwen3.8-max" },
];

/** Headless command per harness. Verified on this Mac: claude 2.1.310, opencode 1.19.4, pi 0.84.4. */
// OpenCode lets the model run shell commands unless told otherwise, and the Document is untrusted input. Deny
// every tool except reading files (checked 25 Oct 2026: with this, Kimi reports it has no bash tool).
const OPENCODE_READ_ONLY = JSON.stringify({ "*": "deny", read: "allow", glob: "allow", grep: "allow", list: "allow" });

const harnesses: Record<string, { name: string; command: (model: string, prompt: string) => string[]; env?: Record<string, string> }> = {
  // Only the Read tool (it reads the PDF); never bypasses permissions. --output-format json wraps the text in .result.
  claude: {
    name: "Claude Code",
    command: (m, p) => ["claude", "-p", p, "--model", m, "--output-format", "json", "--allowedTools", "Read", "--no-session-persistence"],
  },
  // --format json: the answer is the last text event, so a run that ends on a tool call shows up as no result.
  opencode: {
    name: "OpenCode",
    command: (m, p) => ["opencode", "run", "--format", "json", "--model", m, p],
    env: { OPENCODE_PERMISSION: OPENCODE_READ_ONLY },
  },
  pi: { name: "Pi", command: (m, p) => ["pi", "-p", "--model", m, "--no-session", "--tools", "read", p] },
};

/** The command line and extra environment a harness runs with. */
export function harnessCommand(harness: string, model: string, prompt: string) {
  const h = harnesses[harness];
  if (!h) throw new Error(`unknown harness "${harness}": use claude, opencode or pi, or give a command`);
  return { argv: h.command(model, prompt), env: h.env };
}

const PROMPT = `You are doing one Job for a Job Board. The Job is in job.json in the current directory: its instructions, the Template Fields, the Document's text layer and, when the Sieve reads it, the Markdown. The Document itself is document.pdf in the same directory.
Read job.json, look at document.pdf if you can, and do the Job exactly as its instructions say. Do not hand it in yourself.
Print only the result: one JSON object in the shape the instructions give, with no other text and no code fences.`;

/** A harness run may take this long; it stays under the Job Board's 10-minute Job timeout. */
const RUN_TIMEOUT_MS = 9 * 60_000;

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** The JSON object in a harness's stdout: the whole of it, Claude Code's .result wrapper, a fenced block, or the last object in the text. */
export function parseResult(out: string): Record<string, unknown> | undefined {
  const tryParse = (s: string) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(out.trim());
  if (whole?.type === "result" && typeof whole.result === "string") return parseResult(whole.result);
  if (whole) return whole;
  // OpenCode's --format json: one event per line; the answer is the last text part, never a tool's output.
  const events = out.split("\n").filter((l) => l.trim()).map(tryParse);
  if (events.length > 1 && events.every((e) => e && typeof e.part === "object")) {
    const text = events.map((e) => e!.part as { type?: string; text?: string }).filter((p) => p.type === "text" && p.text).at(-1)?.text;
    return text ? parseResult(text) : undefined;
  }
  const fenced = [...out.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/g)].map((m) => tryParse(m[1]!)).findLast(Boolean);
  if (fenced) return fenced;
  // Braces in tool output or prose before the result: try each "{" from the right, up to the last "}".
  const end = out.lastIndexOf("}") + 1;
  for (let a = out.lastIndexOf("{", end); a >= 0; a = out.lastIndexOf("{", a - 1)) {
    const v = tryParse(out.slice(a, end));
    if (v) return v;
    if (a === 0) break;
  }
  return undefined;
}

/** Run a command in `cwd` with no stdin; resolves with stdout and the end of stderr, rejects with that on a non-zero exit. */
function run([cmd, ...args]: string[], cwd: string, signal: AbortSignal, env?: Record<string, string>): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd!, args, { cwd, signal, timeout: RUN_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"], env: env && { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code, sig) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exited ${code ?? sig}: ${err.trim().split("\n").pop() ?? ""}`))));
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
  });

const oneLine = (s: string) => s.replace(/\s+/g, " ").slice(0, 160);

/** Keep every Worker on shift until `signal` aborts. Each Worker does one Job at a time; all run at once. */
export async function runShift(opts: {
  url: string;
  workers: WorkerConfig[];
  signal: AbortSignal;
  fetch?: FetchLike;
  log?: (line: string) => void;
  /** Pause before reconnecting after the Job Board is unreachable. */
  retryMs?: number;
}): Promise<void> {
  const { url, signal, fetch = globalThis.fetch, log = console.log, retryMs = 2000 } = opts;
  const mcpUrl = new URL(`${url.replace(/\/$/, "")}/mcp`);

  /** A client whose calls fail at once when its response stream drops (the SDK would otherwise wait out the timeout). */
  async function connect(name: string) {
    const client = new Client({ name: `shift ${name}`, version: "0" });
    const cut = new AbortController();
    client.onerror = (e) => /disconnected/i.test(e.message) && cut.abort(e);
    await client.connect(new StreamableHTTPClientTransport(mcpUrl, { fetch }));
    return Object.assign(client, { signal: AbortSignal.any([signal, cut.signal]) });
  }
  type Conn = Awaited<ReturnType<typeof connect>>;

  async function call<T>(client: Conn, name: string, args: Record<string, unknown>) {
    const r = await client.callTool({ name, arguments: args }, { signal: client.signal, timeout: 60_000 });
    const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
    return { ok: !r.isError, text, data: r.structuredContent as T };
  }

  async function worker(cfg: WorkerConfig) {
    const h = harnesses[cfg.harness];
    const command = cfg.command ? (p: string) => [...cfg.command!, p] : h?.command.bind(null, cfg.model);
    if (!command) throw new Error(`unknown harness "${cfg.harness}": use claude, opencode or pi, or give a command`);
    const env = cfg.command ? undefined : h?.env;
    const name = `${cfg.harness}/${cfg.model.split("/").pop()}`;
    let id: string | undefined;
    let client: Conn | undefined;
    let down = false;
    while (!signal.aborted) {
      try {
        if (!client) {
          client = await connect(name);
          // Back after a restart or a blip: keep the id we were given.
          const r = await call<{ worker: string }>(client, "register_worker", {
            harness: `${h?.name ?? cfg.harness} · ${cfg.model.split("/").pop()}`,
            label: "shift runner",
            ...(id && { worker: id }),
          });
          if (!r.ok) throw new Error(r.text);
          log(`${r.data.worker} · ${name} · ${id ? "back on" : "on"} shift`);
          id = r.data.worker;
          down = false;
        }
        const r = await call<{ job: Job | null }>(client, "next_job", { worker: id, wait: 25 });
        if (!r.ok) throw new Error(r.text);
        if (r.data.job) await doJob(client, id!, name, command, r.data.job, env);
      } catch (e) {
        if (signal.aborted) break;
        if (!down) log(`${id ?? "?"} · ${name} · Job Board unreachable (${oneLine(String((e as Error)?.message ?? e))}), reconnecting`);
        down = true;
        void client?.close().catch(() => {});
        client = undefined;
        await sleep(retryMs, signal);
      }
    }
    await client?.close().catch(() => {});
  }

  /** Download, run the harness, submit; on a rejection run once more with it appended, then leave the Job to time out. */
  async function doJob(client: Conn, id: string, name: string, command: (prompt: string) => string[], job: Job, env?: Record<string, string>) {
    const started = Date.now();
    const dir = await mkdtemp(join(tmpdir(), "shift-"));
    let outcome: string;
    try {
      const res = await fetch(job.document.url, { signal });
      if (!res.ok) throw new Error(`download ${job.document.url}: ${res.status}`);
      await writeFile(join(dir, "document.pdf"), new Uint8Array(await res.arrayBuffer()));
      await writeFile(join(dir, "job.json"), JSON.stringify(job, null, 2));
      let prompt = PROMPT;
      let rejection = "";
      let out = "";
      let err = "";
      for (let attempt = 1; ; attempt++) {
        let result: Record<string, unknown> | undefined;
        try {
          ({ out, err } = await run(command(prompt), dir, signal, env));
          result = parseResult(out);
          rejection = result ? "" : `your output was not one JSON object (it began: ${JSON.stringify(out.trim().slice(0, 200))})`;
        } catch (e) {
          if (signal.aborted) throw e;
          rejection = `the run failed: ${(e as Error).message}`;
        }
        if (result) {
          const r = await call(client, "submit_job", { worker: id, jobId: job.id, result });
          rejection = r.ok ? "" : r.text;
        }
        if (!rejection) {
          outcome = attempt === 1 ? "submitted" : "submitted on retry";
          break;
        }
        if (attempt === 2) {
          // ponytail: no release tool; the Job goes back on the board at the Job timeout (10 min).
          const kept = join(tmpdir(), `shift-${id}-last-output.txt`);
          await writeFile(kept, `${out}\n--- end of stderr ---\n${err}`);
          outcome = `gave up, back on the board at the Job timeout (${oneLine(rejection)}; output in ${kept})`;
          break;
        }
        prompt = `${PROMPT}\n\nYour previous result was rejected: ${rejection}\nFix it and print only the corrected JSON result.`;
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const doc = job.document.name.replace(/\.pdf$/i, "");
    log(`${id} · ${name} · took ${job.label} for ${doc} · ${Math.round((Date.now() - started) / 1000)} s · ${outcome}`);
  }

  await Promise.all(opts.workers.map(worker));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { values } = parseArgs({ options: { url: { type: "string" } } });
  const url = values.url ?? process.env.DOC2DPP_URL ?? "http://127.0.0.1:3100";
  const stop = new AbortController();
  process.on("SIGINT", () => {
    if (stop.signal.aborted) process.exit(130);
    console.log("Ending the shift (Ctrl-C again to quit at once)...");
    stop.abort();
  });
  console.log(`Shift on ${url}: ${defaultWorkers.map((w) => `${w.harness}/${w.model.split("/").pop()}`).join(", ")}`);
  await runShift({ url, workers: defaultWorkers, signal: stop.signal });
  console.log("Shift over.");
}
