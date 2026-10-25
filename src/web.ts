// Brand and Arbiter web pages, their JSON API, and the MCP endpoint, on one Hono app.
import { Hono } from "hono";
import { html } from "hono/html";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { JobBoard } from "./board.js";
import { formatValue } from "./converge.js";
import { buildMcpServer } from "./mcp.js";
import { addUsdc } from "./ledger.js";
import { templates } from "./templates.js";
import type { ApiTemplate } from "./api.js";

const explorer = (href: string | undefined, what: string) => (href ? html` <a href="${href}">See the ${what} on a Stellar explorer</a>` : "");
const statusOf = { "not found": 404, closed: 409, invalid: 400 } as const;

const layout = (title: string, body: unknown) => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #ddd; padding: .35rem .5rem; text-align: left; vertical-align: top; }
  .muted { color: #888; } q { font-style: italic; }
</style></head><body>${body}</body></html>`;

export interface WebOptions {
  /** Per Operator, scored against testdata/expected at startup (DEMO_REPLAY only). */
  accuracy?: Record<string, { correct: number; fields: number }>;
}

const apiTemplates: ApiTemplate[] = Object.values(templates).map((t) => ({
  name: t.name,
  label: t.label,
  fields: t.fields,
  examples: t.fields.filter((f) => f.highStake).slice(0, 3).map((f) => f.label),
}));

export function webApp(board: JobBoard, opts: WebOptions = {}): Hono {
  const app = new Hono();
  const mcp = createMcpHandler(() => buildMcpServer(board));
  app.all("/mcp", (c) => mcp.fetch(c.req.raw));

  app.get("/api/config", (c) => c.json(board.config()));
  app.get("/api/templates", (c) => c.json(apiTemplates));
  app.get("/api/documents", (c) => c.json(board.documentList()));
  app.post("/api/documents", async (c) => {
    const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = body["file"];
    if (!(file instanceof File)) return c.json({ error: "missing file" }, 400);
    try {
      const meta = await board.upload(new Uint8Array(await file.arrayBuffer()), String(body["template"]), {
        name: file.name,
        supplier: String(body["supplier"] ?? "").trim(),
      });
      return c.json({ id: meta.id }, 201);
    } catch (e) {
      return c.json({ error: `upload rejected: ${(e as Error).message}` }, 400);
    }
  });
  app.get("/api/documents/:id/export", (c) => {
    const id = c.req.param("id");
    if (!board.apiDocument(id)) return c.json({ error: "not found" }, 404);
    const out = board.exportOf(id, c.req.query("pipeline") || undefined);
    if (!out) return c.json({ error: "not delivered yet" }, 409);
    const name = board.apiDocument(id)!.name.replace(/\.pdf$/i, "").replace(/["\\\r\n]/g, "");
    return c.json(out, 200, { "content-disposition": `attachment; filename="${name}.passport.json"` });
  });
  app.get("/api/jobs", (c) => c.json(board.jobList(Number(c.req.query("limit")) || 50)));
  app.get("/api/workers", (c) => c.json(board.workerList()));

  app.get("/", (c) =>
    c.html(
      layout(
        "Documents",
        html`<h1>Upload a Supplier Document</h1>
          <form method="post" action="/upload" enctype="multipart/form-data">
            <input type="file" name="file" accept="application/pdf" required>
            <select name="template">${Object.values(templates).map((t) => html`<option value="${t.name}">${t.label}</option>`)}</select>
            <button>Upload</button>
          </form>
          <p><a href="/arbiter">Arbiter: open Challenges</a> · <a href="/leaderboard">Leaderboard</a></p>
          <h2>Documents</h2>
          <ul>${board.documents().map((d) => html`<li><a href="/documents/${d.id}">${d.id}</a> (${d.template}, ${d.uploadedAt.toISOString()})</li>`)}</ul>`,
      ),
    ),
  );

  app.post("/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) return c.text("missing file", 400);
    try {
      const meta = await board.upload(new Uint8Array(await file.arrayBuffer()), String(body["template"]), { name: file.name });
      return c.redirect(`/documents/${meta.id}`, 303);
    } catch (e) {
      return c.text(`upload rejected: ${(e as Error).message}`, 400);
    }
  });

  app.get("/api/documents/:id", (c) => {
    const d = board.apiDocument(c.req.param("id"));
    return d ? c.json(d) : c.json({ error: "not found" }, 404);
  });

  app.get("/documents/:id/file", async (c) => {
    const bytes = await board.documentBytes(c.req.param("id"));
    if (!bytes) return c.notFound();
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { "content-type": "application/pdf" });
  });

  app.get("/documents/:id", (c) => {
    const d = board.document(c.req.param("id"));
    if (!d) return c.notFound();
    const views = Object.entries(d.pipelines);
    const cell = (f: (typeof d.fields)[number]) =>
      "supplierRequest" in f
        ? html`<td>${f.status}</td><td>Not stated.${f.quotes.length
              ? html` Competing quotes:<ul>${f.quotes.map((q) => html`<li>page ${q.page}: <q>${q.quote}</q></li>`)}</ul>`
              : html`<br>`}
            Supplier Request:<br><textarea readonly rows="5" cols="50">${f.supplierRequest}</textarea>
            <button type="button" onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">Copy</button></td>`
        : "value" in f
          ? html`<td>${f.status}</td><td>${formatValue(f)}${"corrected" in f ? html` <span class="muted">(corrected by Challenge)</span>` : ""}
              <br><span class="muted">p. ${f.page}: <q>${f.quote}</q></span></td>`
          : html`<td>${f.status}</td><td></td>`;
    const rows = d.fields.map((f, i) => html`<tr><th>${f.label}</th>${views.map(([, v]) => cell(v.fields[i]!))}</tr>`);
    const escrow = (name: string, v: (typeof views)[number][1]) =>
      v.escrow
        ? html`<p><b>${name}</b>: Bond locked: ${v.escrow.bond} USDC by ${v.escrow.operator} (Fee ${v.escrow.fee} USDC).
            Output hash: <code>${v.escrow.outputHash}</code>${explorer(v.escrow.link, "escrow")}<br>${v.escrow.status === "settled"
              ? html`${v.escrow.slashes
                  ? `Settled: ${addUsdc(...v.escrow.slashes)} USDC Slashed to the Brand, the rest of the Bond and the Fee paid to the Operator.`
                  : "Settled: Bond and Fee paid to the Operator."}${explorer(v.escrow.settlementLink, v.escrow.slashes ? "settlement and Slashes" : "settlement")}`
              : v.escrow.msLeft > 0
                ? html`${Math.ceil(v.escrow.msLeft / 60_000)} min left in the Challenge Window. <a href="/documents/${d.id}/challenge?pipeline=${name}">Challenge a Field</a>`
                : "Challenge Window closed; waiting for the Arbiter."}</p>`
        : html`<p><b>${name}</b> (${v.operator}): working.</p>`;
    return c.html(
      layout(
        "Document",
        html`<meta http-equiv="refresh" content="3"><p><a href="/">All Documents</a> · <a href="/leaderboard">Leaderboard</a></p>
          <h1>${d.template} Document</h1>
          <p><a href="/documents/${d.id}/file">Original file</a></p>
          ${views.map(([name, v]) => escrow(name, v))}
          <table><tr><th>Field</th>${views.map(([name, v]) => html`<th colspan="2">${name} (${v.operator})</th>`)}</tr>${rows}</table>`,
      ),
    );
  });

  app.post("/api/documents/:id/challenges", async (c) => {
    const { pipeline, ...body } = ((await c.req.json().catch(() => null)) ?? {}) as { pipeline?: string };
    const r = board.challenge(c.req.param("id"), body, pipeline);
    return r.ok ? c.json(r.challenge, 201) : c.json({ error: r.error }, statusOf[r.reason]);
  });

  app.get("/api/leaderboard", async (c) =>
    c.json((await board.leaderboard()).map((r) => ({ ...r, ...(opts.accuracy?.[r.operator] && { accuracy: opts.accuracy[r.operator] }) }))),
  );

  app.get("/leaderboard", async (c) => {
    const rows = (await board.leaderboard()).map(
      (r) => html`<tr><th>${r.operator}</th><td>${r.documents}</td><td>${r.challengesUpheld}</td><td>${r.totalSlashed} USDC</td></tr>`,
    );
    return c.html(
      layout(
        "Leaderboard",
        html`<p><a href="/">All Documents</a></p><h1>Operators</h1>
          <table><tr><th>Operator</th><th>Documents</th><th>Challenges upheld</th><th>Total Slashed</th></tr>${rows}</table>`,
      ),
    );
  });

  app.get("/documents/:id/challenge", (c) => {
    const d = board.document(c.req.param("id"));
    if (!d) return c.notFound();
    const pipeline = c.req.query("pipeline") ?? "";
    return c.html(
      layout(
        "Challenge",
        html`<p><a href="/documents/${d.id}">Back to the Document</a></p>
          <h1>Challenge a Field</h1>
          <p>Cite the page and the exact words of the <a href="/documents/${d.id}/file">Document</a> that state the Correct value.</p>
          <form method="post" action="/documents/${d.id}/challenges">
            <p><select name="pipeline">${Object.entries(d.pipelines).map(([name, v]) => html`<option value="${name}" ${name === pipeline ? "selected" : ""}>${name} (${v.operator})</option>`)}</select>
              <select name="field">${d.fields.map((f) => html`<option value="${f.name}">${f.label}</option>`)}</select></p>
            <p><label>Page <input name="page" type="number" min="1" required></label></p>
            <p><label>Quote <input name="quote" required size="60"></label></p>
            <p><label>Correct value <input name="value" required></label>
              <label>Unit <input name="unit" size="8"></label> <label>Qualifier <input name="qualifier" size="8"></label></p>
            <button>File Challenge</button>
          </form>`,
      ),
    );
  });

  app.post("/documents/:id/challenges", async (c) => {
    const id = c.req.param("id");
    const form = Object.fromEntries(Object.entries(await c.req.parseBody()).filter(([, v]) => v !== ""));
    const { pipeline, ...rest } = form;
    const r = board.challenge(id, rest, typeof pipeline === "string" ? pipeline : undefined);
    return r.ok ? c.redirect(`/documents/${id}`, 303) : c.text(`Challenge rejected: ${r.error}`, statusOf[r.reason]);
  });

  app.get("/api/challenges", (c) => c.json(board.arbiter()));

  const decide = (id: string, decision: unknown, note?: unknown) =>
    decision === "upheld" || decision === "rejected"
      ? board.challenges.decide(id, decision, typeof note === "string" && note.trim() ? note.trim() : undefined)
      : "bad decision";
  const decisionStatus = { ok: 200, unknown: 404, "already decided": 409, "bad decision": 400 } as const;

  app.post("/api/challenges/:id", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { decision?: unknown; note?: unknown };
    const r = decide(c.req.param("id"), body.decision, body.note);
    return c.json(r === "ok" ? { ok: true } : { error: r }, decisionStatus[r]);
  });

  app.post("/challenges/:id/decision", async (c) => {
    const r = decide(c.req.param("id"), (await c.req.parseBody())["decision"]);
    return r === "ok" ? c.redirect("/arbiter", 303) : c.text(r, decisionStatus[r]);
  });

  app.get("/arbiter", (c) => {
    const rows = board.challenges.open().map((ch) => {
      const label = templates[board.document(ch.documentId)!.template]!.fields.find((f) => f.name === ch.field)!.label;
      const d = ch.challenged;
      const challenged =
        d.status === "not stated" ? "Not stated" : "value" in d ? `${formatValue(d)} (p. ${d.page}: “${d.quote}”)` : "Sieves disagree";
      return html`<tr><td><a href="/documents/${ch.documentId}/file">Document</a></td><th>${label}</th><td>${challenged}</td>
        <td>${formatValue(ch)}</td><td>${ch.page}</td><td><q>${ch.quote}</q></td>
        <td><form method="post" action="/challenges/${ch.id}/decision">
          <button name="decision" value="upheld">Uphold</button> <button name="decision" value="rejected">Reject</button>
        </form></td></tr>`;
    });
    return c.html(
      layout(
        "Arbiter",
        html`<p><a href="/">All Documents</a></p><h1>Open Challenges</h1>
          ${rows.length
            ? html`<table><tr><th>Document</th><th>Field</th><th>Delivered</th><th>Claimed Correct</th><th>Page</th><th>Quote</th><th></th></tr>${rows}</table>`
            : html`<p class="muted">No open Challenges.</p>`}`,
      ),
    );
  });

  return app;
}
