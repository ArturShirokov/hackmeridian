// Brand web page, its JSON API, and the MCP endpoint, on one Hono app.
import { Hono } from "hono";
import { html } from "hono/html";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { JobBoard } from "./board.js";
import { buildMcpServer } from "./mcp.js";
import { templates } from "./templates.js";

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
        "supplierRequest" in f
          ? html`<td colspan="5">Not stated. Competing quotes:
              <ul>${f.quotes.map((q) => html`<li>page ${q.page}: <q>${q.quote}</q></li>`)}</ul>
              Supplier Request:<br><textarea readonly rows="5" cols="70">${f.supplierRequest}</textarea>
              <button type="button" onclick="navigator.clipboard.writeText(this.previousElementSibling.value)">Copy</button></td>`
          : "notStated" in f
          ? html`<td colspan="5" class="muted">Not stated</td>`
          : "value" in f
            ? html`<td>${typeof f.value === "object" ? JSON.stringify(f.value) : f.value}</td><td>${f.unit ?? ""}</td><td>${f.qualifier ?? ""}</td><td>${f.page}</td><td><q>${f.quote}</q></td>`
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
                  ? "Settled: Bond and Fee paid to the Operator."
                  : `${Math.ceil(d.escrow.msLeft / 60_000)} min left in the Challenge Window.`}</p>`
            : ""}
          <table><tr><th>Field</th><th>Status</th><th>Value</th><th>Unit</th><th>Qualifier</th><th>Page</th><th>Quote</th></tr>${rows}</table>`,
      ),
    );
  });

  return app;
}
