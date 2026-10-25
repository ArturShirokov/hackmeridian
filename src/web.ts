// Brand and Arbiter web pages, their JSON API, and the MCP endpoint, on one Hono app.
import { Hono } from "hono";
import { html } from "hono/html";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { JobBoard } from "./board.js";
import { buildMcpServer } from "./mcp.js";
import { addUsdc } from "./ledger.js";
import { templates } from "./templates.js";

const show = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));
const statusOf = { "not found": 404, closed: 409, invalid: 400 } as const;

const layout = (title: string, body: unknown) => html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font: 15px/1.4 system-ui, sans-serif; margin: 2rem auto; max-width: 70rem; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; } td, th { border-bottom: 1px solid #ddd; padding: .35rem .5rem; text-align: left; vertical-align: top; }
  .muted { color: #888; } q { font-style: italic; }
</style></head><body>${body}</body></html>`;

export function webApp(board: JobBoard): Hono {
  const app = new Hono();
  const mcp = createMcpHandler(() => buildMcpServer(board));
  app.all("/mcp", (c) => mcp.fetch(c.req.raw));

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
          <p><a href="/arbiter">Arbiter: open Challenges</a></p>
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
      const meta = await board.upload(new Uint8Array(await file.arrayBuffer()), String(body["template"]));
      return c.redirect(`/documents/${meta.id}`, 303);
    } catch (e) {
      return c.text(`upload rejected: ${(e as Error).message}`, 400);
    }
  });

  app.get("/api/documents/:id", (c) => {
    const d = board.document(c.req.param("id"));
    return d ? c.json(d) : c.json({ error: "not found" }, 404);
  });

  app.get("/documents/:id/file", async (c) => {
    const bytes = await board.file(c.req.param("id"));
    if (!bytes) return c.notFound();
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { "content-type": "application/pdf" });
  });

  app.get("/documents/:id", (c) => {
    const d = board.document(c.req.param("id"));
    if (!d) return c.notFound();
    const rows = d.fields.map((f) => {
      const cells =
        "notStated" in f
          ? html`<td colspan="5" class="muted">Not stated</td>`
          : "value" in f
            ? html`<td>${show(f.value)}${"corrected" in f ? html` <span class="muted">(corrected by Challenge)</span>` : ""}</td><td>${f.unit ?? ""}</td><td>${f.qualifier ?? ""}</td><td>${f.page}</td><td><q>${f.quote}</q></td>`
            : html`<td colspan="5" class="muted"></td>`;
      return html`<tr><th>${f.label}</th><td>${f.status}</td>${cells}</tr>`;
    });
    return c.html(
      layout(
        "Document",
        html`<meta http-equiv="refresh" content="3"><p><a href="/">All Documents</a></p>
          <h1>${d.template} Document</h1>
          <p><a href="/documents/${d.id}/file">Original file</a></p>
          ${d.escrow
            ? html`<p>Bond locked: ${d.escrow.bond} USDC by ${d.escrow.operator} (Fee ${d.escrow.fee} USDC).
                Output hash: <code>${d.escrow.outputHash}</code></p>
                <p>${d.escrow.status === "settled"
                  ? d.escrow.slashes
                    ? `Settled: ${addUsdc(...d.escrow.slashes)} USDC Slashed to the Brand, the rest of the Bond and the Fee paid to the Operator.`
                    : "Settled: Bond and Fee paid to the Operator."
                  : d.escrow.msLeft > 0
                    ? html`${Math.ceil(d.escrow.msLeft / 60_000)} min left in the Challenge Window. <a href="/documents/${d.id}/challenge">Challenge a Field</a>`
                    : "Challenge Window closed; waiting for the Arbiter."}</p>`
            : ""}
          <table><tr><th>Field</th><th>Status</th><th>Value</th><th>Unit</th><th>Qualifier</th><th>Page</th><th>Quote</th></tr>${rows}</table>`,
      ),
    );
  });

  app.post("/api/documents/:id/challenges", async (c) => {
    const r = board.challenge(c.req.param("id"), await c.req.json().catch(() => null));
    return r.ok ? c.json(r.challenge, 201) : c.json({ error: r.error }, statusOf[r.reason]);
  });

  app.get("/documents/:id/challenge", (c) => {
    const d = board.document(c.req.param("id"));
    if (!d) return c.notFound();
    return c.html(
      layout(
        "Challenge",
        html`<p><a href="/documents/${d.id}">Back to the Document</a></p>
          <h1>Challenge a Field</h1>
          <p>Cite the page and the exact words of the <a href="/documents/${d.id}/file">Document</a> that state the Correct value.</p>
          <form method="post" action="/documents/${d.id}/challenges">
            <p><select name="field">${d.fields.map((f) => html`<option value="${f.name}">${f.label}</option>`)}</select></p>
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
    const r = board.challenge(id, form);
    return r.ok ? c.redirect(`/documents/${id}`, 303) : c.text(`Challenge rejected: ${r.error}`, statusOf[r.reason]);
  });

  app.get("/api/challenges", (c) => c.json(board.challenges.open()));

  const decide = (id: string, decision: unknown) =>
    decision === "upheld" || decision === "rejected" ? board.challenges.decide(id, decision) : "bad decision";
  const decisionStatus = { ok: 200, unknown: 404, "already decided": 409, "bad decision": 400 } as const;

  app.post("/api/challenges/:id", async (c) => {
    const r = decide(c.req.param("id"), ((await c.req.json().catch(() => ({}))) as { decision?: unknown }).decision);
    return c.json(r === "ok" ? { ok: true } : { error: r }, decisionStatus[r]);
  });

  app.post("/challenges/:id/decision", async (c) => {
    const r = decide(c.req.param("id"), (await c.req.parseBody())["decision"]);
    return r === "ok" ? c.redirect("/arbiter", 303) : c.text(r, decisionStatus[r]);
  });

  app.get("/arbiter", (c) => {
    const rows = board.challenges.open().map((ch) => {
      const label = templates[board.document(ch.documentId)!.template]!.fields.find((f) => f.name === ch.field)!.label;
      const d = ch.disputed;
      const disputed =
        "notStated" in d ? "Not stated" : "value" in d ? `${show(d.value)} ${d.unit ?? ""} (p. ${d.page}: “${d.quote}”)` : "Sieves disagree";
      return html`<tr><td><a href="/documents/${ch.documentId}/file">Document</a></td><th>${label}</th><td>${disputed}</td>
        <td>${show(ch.value)} ${ch.unit ?? ""} ${ch.qualifier ?? ""}</td><td>${ch.page}</td><td><q>${ch.quote}</q></td>
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
