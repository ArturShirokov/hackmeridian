import { expect, test } from "vitest";
import { ApiFailure, makeApi } from "../src/api.ts";

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

test("a failed request carries the server's error text and status", async () => {
  const api = makeApi(reply(400, { error: "quote not found on page 4" }));
  const err = await api.challenge("d1", { pipeline: "ours", field: "f", page: 4, quote: "x", value: "1" }).catch((e) => e);
  expect(err).toBeInstanceOf(ApiFailure);
  expect(err).toMatchObject({ status: 400, message: "quote not found on page 4" });
});

test("fixture mode answers every read route without the network", async () => {
  const api = makeApi(reply(500, {}), () => import("../src/fixtures.ts"));
  expect((await api.documents()).length).toBeGreaterThan(0);
  expect((await api.document("doc-1")).views.map((v) => v.pipeline)).toEqual(["ours", "baseline"]);
  expect((await api.templates()).find((t) => t.name === "battery")!.fields).toHaveLength(60);
  for (const read of [api.config, api.arbiter, api.leaderboard, () => api.jobs(), api.workers]) await expect(read()).resolves.toBeTruthy();
});
