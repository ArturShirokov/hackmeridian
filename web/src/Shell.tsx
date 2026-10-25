// The app shell: "Sign in as" a seeded user, the sidebar and routes of that user's role, and the ?demo story dock.
import { useEffect, useState } from "react";
import { api, usePoll, type ApiUser, type Role } from "./api.ts";
import { ProofLink } from "./components/ui.tsx";
import { usdc } from "./format.ts";
import { Link, match, navigate, useLocation } from "./router.tsx";
import { NotFound } from "./screens.tsx";
import { BrandDocuments } from "./screens/brand/Documents.tsx";
import { BrandUpload } from "./screens/brand/Upload.tsx";
import { BrandPipeline } from "./screens/brand/Pipeline.tsx";
import { BrandReview } from "./screens/brand/Review.tsx";
import { Arbiter } from "./screens/ops/Arbiter.tsx";
import { Jobs } from "./screens/ops/Jobs.tsx";
import { Leaderboard } from "./screens/ops/Leaderboard.tsx";

const NAV: Record<Role, [string, string][]> = {
  brand: [["Documents", "/documents"], ["Upload", "/upload"], ["Leaderboard", "/leaderboard"]],
  arbiter: [["Challenges", "/arbiter"]],
  operator: [["Job Board", "/jobs"], ["Pipelines", "/jobs#pipelines"], ["Leaderboard", "/leaderboard"]],
};
const HOME: Record<Role, string> = { brand: "/documents", arbiter: "/arbiter", operator: "/jobs" };
/** A role sees the screens its sidebar lists (matched on the first path segment); anything else sends it home. */
const allows = (role: Role, path: string) => NAV[role].some(([, to]) => to.split(/[/#]/)[1] === path.split("/")[1]);

/** The signed-in user (undefined while loading), from the signed session cookie. */
function useSession() {
  const [user, setUser] = useState<ApiUser | null>();
  useEffect(() => { api.session().then((s) => setUser(s.user), () => setUser(null)); }, []);
  return {
    user,
    async signIn(id: string, to?: string) {
      const { user } = await api.signIn(id);
      setUser(user);
      if (user) navigate(to ?? HOME[user.role]);
    },
    async signOut() {
      await api.signOut();
      setUser(null);
    },
  };
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
  const { user, signIn, signOut } = useSession();
  const demo = useDemoFlag(url);
  if (user === undefined) return null;
  if (!user) return <SignIn onPick={(id) => signIn(id)} />;
  const role = user.role;
  const { nav, el } = allows(role, url.pathname) ? route(url.pathname) : { nav: "", el: <Redirect to={HOME[role]} /> };
  const asRole = (r: Role, to: string) => signIn(SEATS[r], to);
  return (
    <div className="om-app" style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        <Sidebar user={user} active={nav} onSwitch={signOut} />
        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>{el}</main>
      </div>
      {demo && <StoryDock path={url.pathname} role={role} onRole={asRole} />}
    </div>
  );
}

/** Who the demo dock signs in as for each role. */
const SEATS: Record<Role, string> = { brand: "ines", arbiter: "arbiter", operator: "origyn" };

function SignIn({ onPick }: { onPick(id: string): void }) {
  const { data: users } = usePoll(api.users, 60_000);
  if (!users) return null;
  return (
    <main className="om-app" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ font: "500 30px/1 var(--serif)", marginBottom: 28 }}>Origyn</div>
        <div style={{ font: "600 11px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#3D3A34", marginBottom: 10 }}>Sign in as</div>
        <ul aria-label="Sign in as" style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--rule)" }}>
          {users.map((u) => (
            <li key={u.id}>
              <button onClick={() => onPick(u.id)}
                style={{ width: "100%", border: 0, borderBottom: "1px solid var(--rule)", background: "transparent", textAlign: "left", padding: "14px 4px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                <span style={{ font: "600 15px/1.2 var(--sans)", color: "var(--ink)" }}>{u.name}</span>
                <span style={{ font: "400 13px/1.3 var(--sans)", color: "#3D3A34" }}>{u.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

/** The USDC the Job Board holds for the Brand; Fees and Deposits come out of it, Slashes go in. */
function Balance() {
  const { data } = usePoll(api.balance, 5000);
  if (!data) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--rule)" }}>
      <span style={{ font: "600 11px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#3D3A34" }}>Balance</span>
      <span style={{ font: "600 16px/1 var(--mono)", color: "var(--money)" }}>{usdc(data.usdc)} USDC</span>
      <ProofLink href={data.link} hash="" />
    </div>
  );
}

function Sidebar({ user, active, onSwitch }: { user: ApiUser; active: string; onSwitch(): void }) {
  const role = user.role;
  const lit = NAV[role].find(([, to]) => to === active)?.[1];
  return (
    <aside className="om-desktop-only" style={{ width: 228, flex: "none", borderRight: "1px solid var(--rule)", display: "flex", flexDirection: "column", background: "var(--sidebar)" }}>
      <Link to="/" style={{ padding: "22px 22px 18px", font: "500 26px/1 var(--serif)", color: "var(--ink)", textDecoration: "none" }}>Origyn</Link>
      <div style={{ padding: "0 22px 16px", font: "600 11px/1 var(--sans)", letterSpacing: ".08em", textTransform: "uppercase", color: "#3D3A34" }}>{user.org}</div>
      <nav style={{ display: "flex", flexDirection: "column", borderTop: "1px solid var(--rule)" }}>
        {NAV[role].map(([label, to]) => (
          <Link key={label} to={to} className={`om-nav ${to === lit ? "active" : ""}`}>
            <span style={{ width: 6, height: 6, background: to === lit ? "var(--ink)" : "transparent" }} />
            {label}
          </Link>
        ))}
      </nav>
      <div style={{ marginTop: "auto", padding: "18px 22px", borderTop: "1px solid var(--rule)", display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ font: "600 14px/1.3 var(--sans)" }}>{user.name}</span>
        <span style={{ font: "400 13px/1.3 var(--sans)", color: "#3D3A34" }}>{user.sub}</span>
        {role === "brand" && <Balance />}
        <button onClick={onSwitch}
          style={{ marginTop: 12, height: 28, border: "1px solid var(--ink)", background: "transparent", color: "var(--ink)", font: "600 12px/1 var(--sans)", cursor: "pointer" }}>
          Switch user
        </button>
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
function StoryDock({ path, role: current, onRole }: { path: string; role: Role; onRole(r: Role, to: string): void }) {
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
          <Link key={n} to={to} onClick={(e) => { if (role !== current) { e.preventDefault(); onRole(role, to); } }}
            style={{ height: 30, padding: "0 10px", border: `1px solid ${on ? "var(--paper)" : "var(--dock-bd)"}`, background: on ? "var(--paper)" : "transparent",
              color: on ? "var(--ink)" : "var(--paper)", font: "500 12px/1 var(--sans)", display: "flex", gap: 6, alignItems: "center", textDecoration: "none" }}>
            <span style={{ font: "500 11px/1 var(--mono)" }}>{n}</span>{label}
          </Link>
        );
      })}
    </div>
  );
}
