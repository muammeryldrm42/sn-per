"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CallRow } from "@/lib/archive";
import type { TierId } from "@/lib/tiers";
import { useRemoteEngine } from "@/lib/remote";
import { useLocalCore } from "@/lib/local";
import { useAlerts } from "@/lib/alerts";
import { Shell, type ViewName } from "./Shell";
import { CallsBoard } from "./CallsBoard";
import { LiveView } from "./LiveView";
import { RecordView } from "./RecordView";
import { TokenView } from "./TokenView";
import { SmartMoney } from "./SmartMoney";
import { Heaters } from "./Heaters";
import { PageTitle } from "./ui";
import { TradersView } from "./TradersView";
import { LabView } from "./LabView";
import { MethodView } from "./MethodView";

// With a shared worker configured, everyone reads the same calls from it. Without one, the tab scans by itself.
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "";
const useActiveEngine = WORKER_URL ? () => useRemoteEngine(WORKER_URL) : useLocalCore;

// Calls views are the tiers: #conservative, #calls (balanced), #risky, #ultra.
const viewTier = (v: ViewName): TierId => (v === "conservative" ? "conservative" : v === "risky" ? "risky" : v === "ultra" ? "ultra" : "balanced");
const tierView = (t: TierId): ViewName => (t === "balanced" ? "calls" : t);

interface Route {
  view: ViewName;
  mint?: string;
}

// Views live in the URL hash (#live, #record, #t/<mint>), so links can be shared and the scanner keeps running.
function parseRoute(initialMint?: string): Route {
  if (typeof window === "undefined") return initialMint ? { view: "token", mint: initialMint } : { view: "calls" };
  const legacy = new URLSearchParams(window.location.search).get("mint");
  const h = window.location.hash.replace(/^#\/?/, "");
  // Share pages (/t/<mint>) open on the token unless a view was picked in the hash.
  const pathMint = window.location.pathname.match(/^\/t\/([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1];
  if (!h && pathMint) return { view: "token", mint: pathMint };
  if (h.startsWith("t/")) return { view: "token", mint: h.slice(2) };
  if (!h && legacy) return { view: "token", mint: legacy };
  if (h === "fresh") return { view: "risky" }; // older links to the fresh launch list
  if (["live", "traders", "record", "lab", "method", "smart", "trending", "archive", "calls", "conservative", "risky", "ultra"].includes(h)) return { view: h as ViewName };
  return { view: "calls" };
}

export function CallsApp({ initialMint }: { initialMint?: string } = {}) {
  const engine = useActiveEngine();
  const { signals, stats, workerError, calls, radar, solUsd } = engine;
  const early = useMemo(() => ("early" in engine && Array.isArray(engine.early) ? (engine.early as CallRow[]) : []), [engine]);
  const ultra = useMemo(() => ("ultra" in engine && Array.isArray(engine.ultra) ? (engine.ultra as CallRow[]) : []), [engine]);
  // Token pages show the main call first, then a risky call, then an ultra risky one.
  const anyCalls = useMemo(() => {
    const seen = new Set(calls.map((c) => c.m));
    const out = [...calls];
    for (const r of [...early, ...ultra]) if (!seen.has(r.m)) (seen.add(r.m), out.push(r));
    return out;
  }, [calls, early, ultra]);
  const link = "link" in engine ? (engine.link as string) : "local";
  const alerts = useAlerts(signals);
  const [route, setRoute] = useState<Route>(initialMint ? { view: "token", mint: initialMint } : { view: "calls" });
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(initialMint));
      window.scrollTo({ top: 0 });
    };
    on();
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a share page (/t/<mint>) navigation moves back to the root first, without reloading the scanner.
  const nav = useCallback((hash: string) => {
    if (window.location.pathname !== "/") {
      window.history.pushState(null, "", `/#${hash}`);
      setRoute(parseRoute());
      window.scrollTo({ top: 0 });
    } else window.location.hash = hash;
  }, []);
  const go = useCallback((v: ViewName) => nav(v), [nav]);
  const open = useCallback((mint: string) => nav(`t/${mint}`), [nav]);
  const back = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "calls";
  }, []);

  const remoteUrl = WORKER_URL || undefined;
  const view = route.view;

  return (
    <Shell
      view={view}
      go={go}
      stats={stats}
      calls={calls}
      early={early}
      signals={signals}
      watching={radar}
      solUsd={solUsd}
      remote={!!WORKER_URL}
      link={link}
      workerError={workerError}
      alerts={alerts}
      query={query}
      setQuery={setQuery}
      onOpen={open}
    >
      {(view === "calls" || view === "archive" || view === "conservative" || view === "risky" || view === "ultra") && (
        <CallsBoard
          key={view === "archive" ? "archive" : viewTier(view)}
          tier={viewTier(view)}
          onTier={(t) => go(tierView(t))}
          main={calls}
          early={early}
          ultra={ultra}
          now={now}
          remoteUrl={remoteUrl}
          query={query}
          initialRange={view === "archive" ? "all" : "24h"}
          watching={radar}
          onOpen={open}
        />
      )}
      {view === "live" && <LiveView calls={calls} signals={signals} stats={stats} watching={radar} now={now} query={query} onOpen={open} remoteUrl={remoteUrl} solUsd={solUsd} />}
      {view === "traders" && <TradersView remoteUrl={remoteUrl} solUsd={solUsd} now={now} onOpen={open} />}
      {view === "record" && <RecordView calls={calls} early={early} ultra={ultra} now={now} remoteUrl={remoteUrl} onOpen={open} />}
      {view === "lab" && <LabView remoteUrl={remoteUrl} now={now} onOpen={open} />}
      {view === "method" && <MethodView remoteUrl={remoteUrl} />}
      {view === "smart" && (
        <>
          <PageTitle dim="Smart" bright="Wallets" />
          <p className="-mt-2 mb-5 max-w-3xl text-sm text-muted">
            Wallets that keep buying winners early, learned from the chain itself: early buyers of every token the scanner reads are scored
            once the token plays out. When two or more of them buy the same token within 30 minutes, it reaches the radar.
          </p>
          <div className="card p-4">
            <SmartMoney remoteUrl={remoteUrl} embedded />
          </div>
        </>
      )}
      {view === "trending" && (
        <>
          <PageTitle dim="Trending" bright="Pools" />
          <p className="-mt-2 mb-5 max-w-3xl text-sm text-muted">
            Solana pools under 24 hours old heating up right now (GeckoTerminal), with a wallet read of who holds them. Context only, these
            are not calls.
          </p>
          <div className="card p-4">
            <Heaters remoteUrl={remoteUrl} embedded />
          </div>
        </>
      )}
      {view === "token" && route.mint && (
        <TokenView mint={route.mint} calls={anyCalls} signals={signals} now={now} solUsd={solUsd} remoteUrl={remoteUrl} onBack={back} />
      )}
    </Shell>
  );
}
