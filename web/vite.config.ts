import { createReadStream, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://127.0.0.1:3000";

/** Dev only: the fixtures' fileUrl /fixtures/<name>.pdf serves testdata/documents/<name>.pdf. */
const fixturePdfs: Plugin = {
  name: "fixture-pdfs",
  configureServer(server) {
    server.middlewares.use("/fixtures", (req, res, next) => {
      const file = join(import.meta.dirname, "../testdata/documents", basename(req.url ?? ""));
      if (!file.endsWith(".pdf") || !existsSync(file)) return next();
      res.setHeader("content-type", "application/pdf");
      createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), fixturePdfs],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    proxy: {
      "/api": api,
      "/mcp": api,
      "^/documents/[^/]+/file$": api,
    },
  },
});
