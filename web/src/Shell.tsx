// The app shell: sidebar per role (Brand / Arbiter / Operator, fixed demo identities), routes, and the ?demo story dock.
import { useEffect, useState } from "react";
import { api, usePoll } from "./api.ts";
import { Link, match, navigate, useLocation } from "./router.tsx";
import { NotFound } from "./screens.tsx";
import { BrandDocuments } from "./screens/brand/Documents.tsx";
import { BrandUpload } from "./screens/brand/Upload.tsx";
import { BrandPipeline } from "./screens/brand/Pipeline.tsx";
import { BrandReview } from "./screens/brand/Review.tsx";
import { Arbiter } from "./screens/ops/Arbiter.tsx";
import { Jobs } from "./screens/ops/Jobs.tsx";
import { Leaderboard } from "./screens/ops/Leaderboard.tsx";

export type Role = "brand" | "arbiter" | "operator";

const NAV: Record<Role, [string, string][]> = {
  brand: [["Documents", "/documents"], ["Upload", "/upload"], ["Leaderboard", "/leaderboard"]],
  arbiter: [["Challenges", "/arbiter"]],
  operator: [["Job Board", "/jobs"], ["Pipelines", "/jobs#pipelines"], ["Leaderboard", "/leaderboard"]],
};
const HOME: Record<Role, string> = { brand: "/documents", arbiter: "/arbiter", operator: "/jobs" };
const WHO: Record<Role, { label: string; name: string; sub: string }> = {
  brand: { label: "Voltaris", name: "Inês Duarte", sub: "Product Compliance, Voltaris" },
  arbiter: { label: "Arbiter", name: "Arbiter desk", sub: "Neutral third party" },
  operator: { label: "Operator", name: "Origyn", sub: "Operator console" },
};

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

export function useRole(): [Role, (r: Role) => void] {
  const [role, set] = useState<Role>(() => (store.get("om-role") as Role) ?? "brand");
  return [role, (r) => { store.set("om-role", r); set(r); }];
}

/** Which screen a path shows; `nav` is the sidebar entry it lights up. */
function route(path: string) {
  let m;
  if (path === "/") return { nav: "/documents", el: <Redirect to="/documents" /> };
  if (match("/documents", path)) return { nav: "/documents", el: <BrandDocuments /> };
  if (match("/upload", path)) return { nav: "/upload", el: <BrandUpload /> };
  if ((m = match("/documents/:id/pipeline", path))) return { nav: "/documents", el: <BrandPipeline key={m.id} id={m.id!} /> };
  if ((m = match("/documents/:id", path))) return { nav: "/documents", el: <BrandReview key={m.id} id={m.id!} /> };
  if (match("/arbiter", path)) return { nav: "/arbiter", el: <Arbiter /> };
  if (match("/leaderboard", path)) return { nav: "/leaderboard", el: <Leaderboard /> };
  if (match("/jobs", path)) return { nav: "/jobs", el: <Jobs /> };
  return { nav: "", el: <NotFound /> };
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

export function App() {
  const url = useLocation();
  const [role, setRole] = useRole();
  const { nav, el } = route(url.pathname);
  const demo = useDemoFlag(url);
  const switchRole = (r: Role) => { setRole(r); navigate(HOME[r]); };
  return (
    <div className="om-app" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        <Sidebar role={role} active={nav === "/jobs" && url.hash === "#pipelines" ? "/jobs#pipelines" : nav} onRole={switchRole} />
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>{el}</main>
      </div>
      {demo && <StoryDock path={url.pathname} onRole={setRole} />}
    </div>
  );
}

function Sidebar({ role, active, onRole }: { role: Role; active: string; onRole(r: Role): void }) {
  const who = WHO[role];
  const lit = NAV[role].find(([, to]) => to === active)?.[1];
  return (
    <aside className="om-desktop-only" style={{ width: 228, flex: "none", borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", background: "var(--sidebar)" }}>
      <Link to="/" style={{ padding: "22px 22px 18px", font: "500 26px/1 var(--serif)", color: "var(--ink)", textDecoration: "none" }}>Origyn</Link>
      <div style={{ padding: "0 22px 16px", font: "600 11px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#3D3A34" }}>{who.label}</div>
      <nav style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--rule)" }}>
        {NAV[role].map(([label, to]) => (
          <Link key={label} to={to} className={`om-nav ${to === lit ? "active" : ""}`}>
            <span style={{ width: 6, height: 6, background: to === lit ? "var(--ink)" : "transparent" }} />
            {label}
          </Link>
        ))}
      </nav>
      <div style={{ marginTop: "auto", padding: "18px 22px", borderTop: "1px solid var(--rule)", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ font: "600 14px/1.3 var(--sans)" }}>{who.name}</span>
        <span style={{ font: "400 13px/1.3 var(--sans)", color: "#3D3A34" }}>{who.sub}</span>
        <div role="group" aria-label="Role" style={{ display: "flex", border: "1px solid var(--ink)", marginTop: 12 }}>
          {(["brand", "arbiter", "operator"] as Role[]).map((r) => (
            <button key={r} onClick={() => onRole(r)} aria-pressed={r === role}
              style={{ flex: 1, height: 28, border: 0, background: r === role ? "var(--ink)" : "transparent", color: r === role ? "var(--paper)" : "var(--ink)", font: "600 12px/1 var(--sans)", cursor: "pointer", textTransform: "capitalize" }}>
              {r}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}

/** ?demo turns the dock on for this tab; ?demo=0 turns it off. */
function useDemoFlag(url: URL) {
  const q = url.searchParams.get("demo");
  if (q !== null) { try { sessionStorage.setItem("om-demo", q === "0" ? "" : "1"); } catch { /* ignore */ } }
  try { return !!sessionStorage.getItem("om-demo"); } catch { return q !== null && q !== "0"; }
}

/** The projector's story: links to the real routes of the newest Document. */
function StoryDock({ path, onRole }: { path: string; onRole(r: Role): void }) {
  const { data: docs } = usePoll(api.documents, 5000);
  const id = docs?.[0]?.id;
  const doc = id ? `/documents/${id}` : "/documents";
  const story: [string, string, string, Role][] = [
    ["01", "Landing", "/", "brand"],
    ["02", "Upload", "/upload", "brand"],
    ["03", "Pipeline", id ? `${doc}/pipeline` : doc, "brand"],
    ["04", "Review", doc, "brand"],
    ["05", "Challenge", id ? `${doc}?challenge=1` : doc, "brand"],
    ["06", "Arbiter", "/arbiter", "arbiter"],
    ["07", "Leaderboard", "/leaderboard", "brand"],
    ["08", "Job Board", "/jobs", "operator"],
  ];
  return (
    <div className="om-desktop-only" style={{ flex: "none", height: 46, background: "var(--ink)", color: "var(--paper)", display: "flex", alignItems: "center", gap: 6, padding: "0 14px", position: "relative", zIndex: 20 }}>
      <span style={{ font: "600 10.5px/1 var(--mono)", letterSpacing: ".1em", color: "var(--grey-3)", marginRight: 8 }}>DEMO</span>
      {story.map(([n, label, to, role]) => {
        const on = to === path + (new URLSearchParams(location.search).has("challenge") ? "?challenge=1" : "");
        return (
          <Link key={n} to={to} onClick={() => onRole(role)}
            style={{ height: 30, padding: "0 10px", border: `1px solid ${on ? "var(--paper)" : "var(--dock-bd)"}`, background: on ? "var(--paper)" : "transparent",
              color: on ? "var(--ink)" : "var(--paper)", font: "500 12px/1 var(--sans)", display: "flex", gap: 6, alignItems: "center", textDecoration: "none" }}>
            <span style={{ font: "500 11px/1 var(--mono)" }}>{n}</span>{label}
          </Link>
        );
      })}
    </div>
  );
}
