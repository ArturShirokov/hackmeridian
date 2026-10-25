// Storage adapter: Document bytes plus metadata. The real one is ICP; the fake keeps everything in memory.
import { createHash, randomUUID } from "node:crypto";

export interface DocumentMeta {
  id: string;
  /** sha256 of the bytes, hex. */
  hash: string;
  template: string;
  uploader: string;
  /** The uploaded file name. */
  name: string;
  supplier: string;
  uploadedAt: Date;
}

export type NewDocument = Pick<DocumentMeta, "template" | "uploader" | "name" | "supplier">;

export interface Storage {
  put(bytes: Uint8Array, meta: NewDocument): Promise<DocumentMeta>;
  get(id: string): Promise<{ meta: DocumentMeta; bytes: Uint8Array } | undefined>;
  /** Documents uploaded at or after `since`, oldest first. */
  listSince(since: Date): Promise<DocumentMeta[]>;
}

export class InMemoryStorage implements Storage {
  private docs = new Map<string, { meta: DocumentMeta; bytes: Uint8Array }>();

  async put(bytes: Uint8Array, meta: NewDocument) {
    const m: DocumentMeta = { id: randomUUID(), hash: createHash("sha256").update(bytes).digest("hex"), ...meta, uploadedAt: new Date() };
    this.docs.set(m.id, { meta: m, bytes });
    return m;
  }

  async get(id: string) {
    return this.docs.get(id);
  }

  async listSince(since: Date) {
    return [...this.docs.values()].map((d) => d.meta).filter((m) => m.uploadedAt >= since);
  }
}
