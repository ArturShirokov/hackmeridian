import { expect, test } from "vitest";
import { makePdf, startBoard } from "./seam.js";

test("the health check answers OK with the number of Documents, for the deploy script and uptime checks", async () => {
  const board = startBoard();
  const first = await board.web.request("/api/health");
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ ok: true, documents: 0 });

  await board.brand.upload(await makePdf([["Rated capacity: 3.2 Ah"]]), "battery");
  expect(await (await board.web.request("/api/health")).json()).toMatchObject({ ok: true, documents: 1 });
});
