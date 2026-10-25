import { expect, test } from "vitest";
import { extraction, makePdf, startBoard } from "./seam.js";

test("the seeded users can sign in, and the session cookie says who is signed in", async () => {
  const { users } = startBoard();
  expect((await users.list()).map((u) => [u.id, u.name, u.role])).toEqual([
    ["ines", "Inês Duarte", "brand"],
    ["arbiter", "Arbiter desk", "arbiter"],
    ["origyn", "Origyn Operator", "operator"],
    ["baseline", "Baseline Operator", "operator"],
  ]);
  expect(await users.as().session()).toEqual({ user: null });

  const { status, cookie } = await users.signIn("ines");
  expect(status).toBe(200);
  expect(await users.as(cookie).session()).toMatchObject({ user: { id: "ines", name: "Inês Duarte", role: "brand", org: "Voltaris" } });
  expect((await users.signIn("mallory")).status).toBe(404);
});

test("a tampered session cookie is rejected", async () => {
  const { users } = startBoard();
  const { cookie } = await users.signIn("ines");
  const [name, value] = cookie!.split("=");
  const forged = `${name}=${encodeURIComponent(decodeURIComponent(value!).replace("ines", "arbiter"))}`;
  expect(await users.as(forged).session()).toEqual({ user: null });
  expect(await users.as(`${name}=arbiter`).session()).toEqual({ user: null });
});

const sheet = () => makePdf([["Voltaris NMC-800", "Rated capacity: 220 Ah"]]);
const wrongCapacity = { value: 22, unit: "Ah", qualifier: "rated", page: 1, quote: "Rated capacity: 220 Ah" };
const capacityChallenge = { field: "rated_capacity_ah", page: 1, quote: "Rated capacity: 220 Ah", value: 220, unit: "Ah", qualifier: "rated" };

test("the Brand's USDC balance pays the Fee and the Challenge Deposit, and receives the Slash and the Deposit back", async () => {
  const board = startBoard({
    explorer: "https://explorer.test",
    challengeWindowMs: 60_000,
    arbiterFee: "0.1",
    operators: { baseline: { operator: "op-baseline", bond: "10", fee: "2.5" } },
  });
  const ines = board.users.as((await board.users.signIn("ines")).cookie);
  expect(await ines.balance()).toEqual({ status: 200, body: { usdc: "100", link: "https://explorer.test/account/brand" } });

  const docId = await board.brand.upload(await sheet());
  const w = await board.worker("w1");
  const job = (await w.nextJob())!;
  await w.submitJob(job.id, extraction(job, { rated_capacity_ah: wrongCapacity }));
  expect((await ines.balance()).body.usdc).toBe("97.5");

  expect((await board.brand.challenge(docId, capacityChallenge)).status).toBe(201);
  expect((await ines.balance()).body.usdc).toBe("96.5");

  const [open] = await board.arbiter.challenges();
  await board.arbiter.decide(open!.id, "upheld");
  board.clock.advance(60_000);
  await board.tick();
  // A Slash of a tenth of the 10 USDC Bond, less the 0.1 Arbiter Fee, and the 1 USDC Deposit back.
  expect((await ines.balance()).body.usdc).toBe("98.4");
});

test("only a signed-in Brand user has a balance", async () => {
  const { users } = startBoard();
  expect((await users.as().balance()).status).toBe(401);
  expect((await users.as((await users.signIn("arbiter")).cookie).balance()).status).toBe(403);
  expect((await users.as((await users.signIn("origyn")).cookie).balance()).status).toBe(403);
});
