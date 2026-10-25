// Storage adapter: Document bytes plus metadata. The real one is ICP; the fake keeps everything in memory.
import { createHash, randomUUID } from "node:crypto";

export interface DocumentMeta {
  id: string;
  /** sha256 of the bytes, hex. */
  hash: string;
  template: string;
  uploader: string;
  uploadedAt: Date;
}

export interface Storage {
  put(bytes: Uint8Array, meta: { template: string; uploader: string }): Promise<DocumentMeta>;
  get(id: string): Promise<{ meta: DocumentMeta; bytes: Uint8Array } | undefined>;
  /** Documents uploaded at or after `since`, oldest first. */
  listSince(since: Date): Promise<DocumentMeta[]>;
}

export class InMemoryStorage implements Storage {
  private docs = new Map<string, { meta: DocumentMeta; bytes: Uint8Array }>();

  async put(bytes: Uint8Array, { template, uploader }: { template: string; uploader: string }) {
    const meta: DocumentMeta = {
      id: randomUUID(),
      hash: createHash("sha256").update(bytes).digest("hex"),
      template,
      uploader,
      uploadedAt: new Date(),
    };
    this.docs.set(meta.id, { meta, bytes });
    return meta;
  }

  async get(id: string) {
    return this.docs.get(id);
  }

  async listSince(since: Date) {
    return [...this.docs.values()].map((d) => d.meta).filter((m) => m.uploadedAt >= since);
  }
}
