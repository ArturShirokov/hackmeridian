// Typed client for the Job Board's JSON API (contract: src/api.ts) and a polling hook.
// Build or run with VITE_FIXTURES=1 to read fixture JSON instead (`npm run dev:web` does until the routes land);
// without it the fixtures are not in the bundle.
import { useEffect, useRef, useState } from "react";
import type {
  ApiArbiter, ApiConfig, ApiDocument, ApiDocumentSummary, ApiJob, ApiLeaderRow, ApiTemplate, ApiWorker,
} from "../../src/api.ts";

export type * from "../../src/api.ts";

export class ApiFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface ChallengeBody {
  pipeline: string;
  field: string;
  page: number;
  quote: string;
  value: string | number | Record<string, number>;
  unit?: string;
  qualifier?: string;
}

type Fixtures = typeof import("./fixtures.ts");

export function makeApi(fetcher: typeof fetch, loadFixtures?: () => Promise<Fixtures>) {
  async function send<T>(path: string, init?: RequestInit): Promise<T> {
    if (loadFixtures) return (await loadFixtures()).respond(path, init) as T;
    const res = await fetcher(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiFailure(res.status, (body as { error?: string }).error ?? res.statusText);
    return body as T;
  }
  const post = <T>(path: string, body: unknown) =>
    send<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  return {
    config: () => send<ApiConfig>("/api/config"),
    templates: () => send<ApiTemplate[]>("/api/templates"),
    documents: () => send<ApiDocumentSummary[]>("/api/documents"),
    document: (id: string) => send<ApiDocument>(`/api/documents/${id}`),
    arbiter: () => send<ApiArbiter>("/api/challenges"),
    leaderboard: () => send<ApiLeaderRow[]>("/api/leaderboard"),
    jobs: (limit = 50) => send<ApiJob[]>(`/api/jobs?limit=${limit}`),
    workers: () => send<ApiWorker[]>("/api/workers"),
    challenge: (documentId: string, body: ChallengeBody) => post<{ id: string }>(`/api/documents/${documentId}/challenges`, body),
    decide: (id: string, decision: "upheld" | "rejected", note?: string) => post<{ ok: true }>(`/api/challenges/${id}`, { decision, note }),
    exportUrl: (id: string, pipeline: string) => `/api/documents/${id}/export?pipeline=${encodeURIComponent(pipeline)}`,
    /** POST /api/documents with real upload progress (0..1). */
    upload(file: File, template: string, supplier: string, onProgress?: (fraction: number) => void): Promise<{ id: string }> {
      if (loadFixtures) return loadFixtures().then((f) => f.fakeUpload(onProgress));
      const form = new FormData();
      form.set("file", file);
      form.set("template", template);
      form.set("supplier", supplier);
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/documents");
        xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
        xhr.onerror = () => reject(new ApiFailure(0, "The connection dropped."));
        xhr.onload = () => {
          const body = JSON.parse(xhr.responseText || "{}");
          if (xhr.status === 201) resolve(body);
          else reject(new ApiFailure(xhr.status, body.error ?? xhr.statusText));
        };
        xhr.send(form);
      });
    },
  };
}

export const api = makeApi(
  (...a) => fetch(...a),
  import.meta.env.VITE_FIXTURES === "1" ? () => import("./fixtures.ts") : undefined,
);

/** Calls `load` now and every `ms`, and again when `deps` change. Keeps the last good data on a failed poll. */
export function usePoll<T>(load: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: Error }>({});
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let live = true;
    setState({});
    const run = () =>
      loadRef.current().then(
        (data) => live && setState({ data }),
        (error: Error) => live && setState((s) => ({ data: s.data, error })),
      );
    run();
    const t = setInterval(run, ms);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [ms, ...deps]);
  return state;
}
