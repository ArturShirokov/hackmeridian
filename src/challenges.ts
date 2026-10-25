// Challenges: the Brand cites a page and a quote against one delivered Field; the Arbiter upholds or rejects.
// The Job Board decides when a Challenge may be filed (the Challenge Window) and settles with the upheld ones.
import { randomUUID } from "node:crypto";
import * as z from "zod";
import type { FieldResult } from "./converge.js";
import { mustBe, statedValue, type Template } from "./templates.js";

const input = z.strictObject({ field: z.string(), ...statedValue, page: z.coerce.number().int().positive() });

export type Challenge = z.infer<typeof input> & {
  id: string;
  documentId: string;
  pipeline: string;
  /** The delivered value being challenged, as the Brand saw it. */
  challenged: FieldResult;
  decision?: "upheld" | "rejected";
};

/** The delivered Document and Pipeline a Challenge is filed against. */
export interface Target {
  documentId: string;
  pipeline: string;
  template: Template;
  pages: number;
  delivered: FieldResult[];
}

export class Challenges {
  private all: Challenge[] = [];

  fileChallenge(t: Target, raw: unknown): { ok: true; challenge: Challenge } | { ok: false; error: string } {
    const r = input.safeParse(raw);
    if (!r.success) return { ok: false, error: z.prettifyError(r.error) };
    const c = r.data;
    const f = t.template.fields.find((f) => f.name === c.field);
    if (!f) return { ok: false, error: `unknown Field "${c.field}"` };
    if (c.page > t.pages) return { ok: false, error: `page ${c.page} but the Document has ${t.pages} pages` };
    // Form posts send every value as a string; read it as the Field's type.
    if (typeof c.value === "string" && f.type === "quantity") c.value = Number(c.value);
    if (typeof c.value === "string" && f.type === "composition") {
      try {
        c.value = z.record(z.string(), z.number()).parse(JSON.parse(c.value));
      } catch {
        return { ok: false, error: `Field "${f.name}": ${mustBe.composition}` };
      }
    }
    if (Number.isNaN(c.value)) return { ok: false, error: `Field "${f.name}": ${mustBe.quantity}` };
    const challenged = t.delivered.find((d) => d.field === f.name)!;
    const challenge: Challenge = { ...c, id: randomUUID(), documentId: t.documentId, pipeline: t.pipeline, challenged };
    this.all.push(challenge);
    return { ok: true, challenge };
  }

  /** Challenges waiting for the Arbiter, oldest first. */
  open(): Challenge[] {
    return this.all.filter((c) => !c.decision);
  }

  decide(id: string, decision: "upheld" | "rejected"): "ok" | "unknown" | "already decided" {
    const c = this.all.find((c) => c.id === id);
    if (!c) return "unknown";
    if (c.decision) return "already decided";
    c.decision = decision;
    return "ok";
  }

  private of(documentId: string, pipeline: string) {
    return this.all.filter((c) => c.documentId === documentId && c.pipeline === pipeline);
  }

  undecided(documentId: string, pipeline: string): boolean {
    return this.of(documentId, pipeline).some((c) => !c.decision);
  }

  upheld(documentId: string, pipeline: string): Challenge[] {
    return this.of(documentId, pipeline).filter((c) => c.decision === "upheld");
  }

  /** The corrected value for a Field: the latest upheld Challenge on it. */
  correction(documentId: string, pipeline: string, field: string) {
    const c = this.upheld(documentId, pipeline).findLast((c) => c.field === field);
    return c && { value: c.value, unit: c.unit, qualifier: c.qualifier, page: c.page, quote: c.quote, corrected: true as const };
  }
}
