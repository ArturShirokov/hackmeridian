// Brand: every uploaded Document with its Supplier, Template, status per Pipeline and Challenge Window left.
import { api, usePoll } from "../../api.ts";
import { Link } from "../../router.tsx";
import { Button, Countdown } from "../../components/ui.tsx";
import { PageHeader, useServerClock } from "../../screens.tsx";
import { Loading, templateLabel } from "./common.tsx";
import { listStatus } from "./derive.ts";

const th = { font: "600 11px/1 var(--sans)", letterSpacing: ".07em", textTransform: "uppercase", color: "#2A2723" } as const;
const cols = "minmax(0,2fr) minmax(0,1.2fr) 150px minmax(0,1.8fr) 120px";

export function BrandDocuments() {
  const { data, error } = usePoll(api.documents, 5000);
  const { config, offset } = useServerClock();
  const labels = Object.fromEntries((config?.operators ?? []).map((o) => [o.pipeline, o.label]));
  return (
    <div style={{ flex: 1, overflow: "auto" }}>
      <PageHeader eyebrow={config?.brand.name ?? "Brand"} title="Documents" pad="36px 48px 20px" right={<Link to="/upload"><Button>Upload a Document</Button></Link>} />
      {!data ? <Loading error={error} /> : (
        <div style={{ padding: "28px 48px 48px" }}>
          <div style={{ border: "1px solid var(--ink)", background: "var(--surface)" }}>
            <div style={{ display: "grid", gridTemplateColumns: cols, gap: 12, padding: "12px 20px", borderBottom: "1px solid var(--ink)", ...th }}>
              <span>Document</span><span>Supplier</span><span>Template</span><span>Status</span><span>Window left</span>
            </div>
            {data.length === 0 && <div style={{ padding: "18px 20px", font: "400 15px/1.4 var(--sans)", color: "#2A2723" }}>No Documents yet. Upload a Supplier Document to start.</div>}
            {data.map((d) => {
              const ps = Object.values(d.pipelines);
              const processing = ps.some((p) => p.status === "processing");
              const closesAt = ps.map((p) => p.closesAt).find((c) => c);
              return (
                <Link key={d.id} to={processing ? `/documents/${d.id}/pipeline` : `/documents/${d.id}`}                  style={{ display: "grid", gridTemplateColumns: cols, gap: 12, alignItems: "center", padding: "0 20px", minHeight: 52, borderBottom: "1px solid var(--rule-row)", color: "var(--ink)", textDecoration: "none" }}>
                  <span style={{ font: "500 14.5px/1.25 var(--sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
                  <span style={{ font: "400 14px/1.25 var(--sans)" }}>{d.supplier || "—"}</span>
                  <span style={{ font: "400 14px/1.25 var(--sans)" }}>{templateLabel(d.template)}</span>
                  <span style={{ font: "500 12.5px/1.4 var(--mono)", color: "#2A2723" }}>{listStatus(d.pipelines, labels)}</span>
                  <span>
                    {closesAt && config && !processing
                      ? <Countdown bare closesAt={closesAt} windowMs={config.challengeWindowMs} serverOffsetMs={offset} settled={ps.every((p) => p.status === "settled")} />
                      : <span style={{ font: "500 14px/1 var(--mono)", color: "#5E594F" }}>—</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
