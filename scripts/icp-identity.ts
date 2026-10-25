// The Job Board's ICP identity and Task: writes ICP_IDENTITY (an Ed25519 seed, never printed) and ICP_TASK_ID
// to .env (or ENV_FILE) if missing, creating the "doc2dpp Documents" Task on first run. Prints the principal.
import { randomBytes } from "node:crypto";
import { ensureTask, icpActor, icpIdentity } from "../src/storage/icp.js";
import { ENV, readEnv, writeEnv } from "./wallets.js";

const env = readEnv();
if (!env.get("ICP_IDENTITY")) env.set("ICP_IDENTITY", randomBytes(32).toString("hex"));
const seed = env.get("ICP_IDENTITY")!;
const principal = icpIdentity(seed).getPrincipal();
if (!env.get("ICP_TASK_ID")) env.set("ICP_TASK_ID", String(await ensureTask(await icpActor(seed), principal)));
writeEnv(env);
console.log(`ICP principal ${principal.toText()}, Task ${env.get("ICP_TASK_ID")} (in ${ENV})`);
