// Storage on Viktoria's ICP canister: every Document is a file in one Task ("doc2dpp Documents"), public by URL.
// The canister keeps only the file name, so the metadata rides in it: <first 16 hex of sha256>.<template>.<uploader>.<supplier>.<name>.pdf
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Actor, HttpAgent } from "@dfinity/agent";
import { IDL } from "@dfinity/candid";
import { Ed25519KeyIdentity } from "@dfinity/identity";
import { Principal } from "@dfinity/principal";
import type { DocumentMeta, NewDocument, Storage } from "../storage.js";

export const ICP_HOST = "https://icp-api.io";
export const ICP_CANISTER = "mvxva-paaaa-aaaaj-qsm6a-cai";
export const TASK_TITLE = "doc2dpp Documents";
const CHUNK = 1024 * 1024;
const MAX_FILE = 50 * 1024 * 1024;

type Result<T> = { Ok: T } | { Err: string };
/** The parts of the canister's FileEntry we read (its `hash` holds the path, not a content hash). */
export interface FileEntry { entry_name: string; path: string; url: string; hash: string; size: bigint; content_type: string; added_at_ns: bigint }
type Key = { token_id: bigint; entry_name: string };
export interface IcpActor {
  create_task(a: { title: string; description: string }): Promise<Result<bigint>>;
  list_tasks(a: { offset: [] | [bigint]; limit: [] | [bigint]; owner: [] | [Principal]; writable_by: [] | [Principal] }): Promise<{ total: bigint; tasks: { id: bigint; title: string }[] }>;
  get_task(id: bigint): Promise<[] | [{ id: bigint; title: string; files: FileEntry[] }]>;
  task_init_upload(a: Key & { file_size: bigint; file_hash: [] | [string]; chunk_size: [] | [bigint]; content_type: [] | [string] }): Promise<Result<string>>;
  task_store_chunk(a: Key & { chunk_id: bigint; chunk_data: Uint8Array }): Promise<Result<null>>;
  task_finalize_upload(a: Key): Promise<Result<FileEntry>>;
  task_cancel_upload(a: Key): Promise<Result<null>>;
}

// Space reads back as "_"; anything else outside [A-Za-z0-9-] (dots too, they split the parts) becomes "-".
const slug = (s: string, max = 24) => s.replace(/[^A-Za-z0-9 -]/g, "-").replaceAll(" ", "_").slice(0, max);
const unslug = (s: string) => s.replaceAll("_", " ");
const MAX_ENTRY = 120; // the canister's limit

/** The hash goes in as its first 16 hex digits; the file name takes whatever room is left. */
export function entryName(m: Pick<DocumentMeta, "hash" | "template" | "uploader" | "supplier" | "name">) {
  const head = [m.hash.slice(0, 16), m.template, m.uploader, m.supplier].map((s) => slug(s)).join(".");
  return `${head}.${slug(m.name.replace(/\.pdf$/i, ""), MAX_ENTRY - head.length - 5)}.pdf`;
}

/** Undefined for files in the Task that are not Documents of ours. */
export function parseEntryName(entry: string) {
  const parts = entry.split(".");
  if (parts.length !== 6 || parts[5] !== "pdf" || !/^[0-9a-f]{16}$/.test(parts[0]!)) return undefined;
  const [hash, template, uploader, supplier, name] = parts.map(unslug) as [string, string, string, string, string];
  return { hash, template, uploader, supplier, name: `${name}.pdf` };
}

const ok = <T>(r: Result<T>, what: string): T => {
  if ("Err" in r) throw new Error(`ICP ${what}: ${r.Err}`);
  return r.Ok;
};

/** The canister rate-limits management calls; retry those like Viktoria's frontend does. */
async function retry<T>(f: () => Promise<Result<T>>, what: string): Promise<T> {
  for (let i = 1; ; i++) {
    const r = await f();
    if ("Ok" in r || i >= 8 || !/ConcurrentManagementCall|Rate limit/i.test(r.Err)) return ok(r, what);
    await new Promise((res) => setTimeout(res, 400 * i));
  }
}

export class IcpStorage implements Storage {
  private actor: IcpActor;
  private taskId: bigint;
  private fetch: typeof fetch;

  constructor(opts: { actor: IcpActor; taskId: bigint; fetch?: typeof fetch }) {
    this.actor = opts.actor;
    this.taskId = opts.taskId;
    this.fetch = opts.fetch ?? fetch;
  }

  async put(bytes: Uint8Array, meta: NewDocument): Promise<DocumentMeta> {
    if (bytes.length > MAX_FILE) throw new Error("Files over 50 MB are not accepted");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const key = { token_id: this.taskId, entry_name: entryName({ hash, ...meta }) };
    await retry(() => this.actor.task_init_upload({
      ...key, file_size: BigInt(bytes.length), file_hash: [hash], chunk_size: [BigInt(CHUNK)], content_type: ["application/pdf"],
    }), "init upload");
    try {
      for (let i = 0; i * CHUNK < bytes.length; i++)
        await retry(() => this.actor.task_store_chunk({ ...key, chunk_id: BigInt(i), chunk_data: bytes.subarray(i * CHUNK, (i + 1) * CHUNK) }), "store chunk");
      return { ...this.meta(await retry(() => this.actor.task_finalize_upload(key), "finalize upload"))!, hash };
    } catch (e) {
      await this.actor.task_cancel_upload(key).catch(() => {});
      throw e;
    }
  }

  async get(id: string) {
    const meta = (await this.list()).find((m) => m.id === id);
    if (!meta) return undefined;
    const res = await this.fetch(meta.link!);
    if (!res.ok) throw new Error(`ICP file ${meta.link}: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (!hash.startsWith(meta.hash)) throw new Error(`ICP file ${meta.link}: bytes don't match the hash`);
    return { meta: { ...meta, hash }, bytes };
  }

  async listSince(since: Date) {
    return (await this.list()).filter((m) => m.uploadedAt >= since);
  }

  private async list(): Promise<DocumentMeta[]> {
    const [task] = await this.actor.get_task(this.taskId);
    if (!task) throw new Error(`ICP Task ${this.taskId} not found`);
    return task.files.flatMap((f) => this.meta(f) ?? []).sort((a, b) => +a.uploadedAt - +b.uploadedAt);
  }

  private meta(f: FileEntry): DocumentMeta | undefined {
    const m = parseEntryName(f.entry_name);
    // ponytail: id is the hash prefix, so the same bytes with the same metadata can't be stored twice.
    return m && { id: m.hash.slice(0, 16), ...m, uploadedAt: new Date(Number(f.added_at_ns / 1_000_000n)), link: f.url };
  }
}

const idl: IDL.InterfaceFactory = ({ IDL: I }) => {
  const r = <T>(ok: IDL.Type<T>) => I.Variant({ Ok: ok, Err: I.Text });
  const file = I.Record({ entry_name: I.Text, path: I.Text, url: I.Text, hash: I.Text, size: I.Nat64, content_type: I.Text, author: I.Principal, added_at_ns: I.Nat64 });
  const task = I.Record({ id: I.Nat, title: I.Text, description: I.Text, owner: I.Principal, created_by: I.Principal, created_at_ns: I.Nat64, agents: I.Vec(I.Principal), files: I.Vec(file) });
  const summary = I.Record({ id: I.Nat, title: I.Text, owner: I.Principal, created_at_ns: I.Nat64, file_count: I.Nat64, last_activity_ns: I.Nat64 });
  const key = I.Record({ token_id: I.Nat, entry_name: I.Text });
  return I.Service({
    create_task: I.Func([I.Record({ title: I.Text, description: I.Text })], [r(I.Nat)], []),
    task_init_upload: I.Func([I.Record({ token_id: I.Nat, entry_name: I.Text, file_size: I.Nat64, file_hash: I.Opt(I.Text), chunk_size: I.Opt(I.Nat64), content_type: I.Opt(I.Text) })], [r(I.Text)], []),
    task_store_chunk: I.Func([I.Record({ token_id: I.Nat, entry_name: I.Text, chunk_id: I.Nat, chunk_data: I.Vec(I.Nat8) })], [r(I.Null)], []),
    task_finalize_upload: I.Func([key], [r(file)], []),
    task_cancel_upload: I.Func([key], [r(I.Null)], []),
    get_task: I.Func([I.Nat], [I.Opt(task)], ["query"]),
    list_tasks: I.Func([I.Record({ offset: I.Opt(I.Nat64), limit: I.Opt(I.Nat64), owner: I.Opt(I.Principal), writable_by: I.Opt(I.Principal) })], [I.Record({ total: I.Nat64, tasks: I.Vec(summary) })], ["query"]),
  });
};

/** The Job Board's ICP identity, from the 32-byte seed in ICP_IDENTITY (hex). */
export const icpIdentity = (seedHex: string) => Ed25519KeyIdentity.generate(new Uint8Array(Buffer.from(seedHex, "hex")));

export async function icpActor(seedHex: string): Promise<IcpActor> {
  const agent = await HttpAgent.create({ host: ICP_HOST, identity: icpIdentity(seedHex) });
  return Actor.createActor(idl, { agent, canisterId: ICP_CANISTER }) as unknown as IcpActor;
}

/** Our Task: the one titled "doc2dpp Documents" that we own, created on first use. */
export async function ensureTask(actor: IcpActor, owner: Principal): Promise<bigint> {
  const { tasks } = await actor.list_tasks({ offset: [], limit: [100n], owner: [owner], writable_by: [] });
  const found = tasks.find((t) => t.title === TASK_TITLE);
  return found ? found.id : retry(() => actor.create_task({ title: TASK_TITLE, description: "Supplier Documents uploaded to doc2dpp (HackMeridian 2026)." }), "create task");
}

/** STORAGE=icp: reads ICP_IDENTITY (and ICP_TASK_ID, else finds or creates the Task) from .env or ENV_FILE. */
export async function icpStorageFromEnv(): Promise<IcpStorage> {
  const file = process.env.ENV_FILE ?? ".env";
  if (existsSync(file)) process.loadEnvFile(file);
  const seed = process.env.ICP_IDENTITY;
  if (!seed) throw new Error(`ICP_IDENTITY missing from ${file}; run scripts/icp-identity.ts`);
  const actor = await icpActor(seed);
  const taskId = process.env.ICP_TASK_ID ? BigInt(process.env.ICP_TASK_ID) : await ensureTask(actor, icpIdentity(seed).getPrincipal());
  return new IcpStorage({ actor, taskId });
}
