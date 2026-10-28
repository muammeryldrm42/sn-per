"use client";

import { useEffect, useState } from "react";
import { useEngine } from "@/lib/engine";
import { useRemoteEngine } from "@/lib/remote";
import { useLocalCore } from "@/lib/local";
import { NARRATIVE_ENABLED } from "@/lib/flags";
import type { CallRow } from "@/lib/archive";
import { Archive } from "@/components/Archive";
import { useAlerts } from "@/lib/alerts";
import { Header } from "@/components/Header";
import { NarrativeWall } from "@/components/NarrativeWall";
import { SignalFeed } from "@/components/SignalFeed";
import { Watchlist } from "@/components/Watchlist";
import { Report } from "@/components/Report";
import { Heaters } from "@/components/Heaters";
import { Calls } from "@/components/Calls";
import { CALLS_ENABLED } from "@/lib/calls";
import { TrackRecord } from "@/components/TrackRecord";
import { SmartMoney } from "@/components/SmartMoney";
import { perf } from "@/lib/format";

// With a shared worker configured, everyone reads the same signals from it. Without one, the tab scans by itself.
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || "";
const useLocal = () => ({
  ...useEngine(),
  workerError: null as string | null,
  calls: [] as CallRow[],
  radar: 0,
  solUsd: null as number | null,
});
// Narrative mode keeps the old browser engine; the on-chain scanner runs lib/core.ts in the tab.
const useActiveEngine = WORKER_URL ? () => useRemoteEngine(WORKER_URL) : NARRATIVE_ENABLED ? useLocal : useLocalCore;

// The old narrative page, used only when NEXT_PUBLIC_NARRATIVE=1.
export function LegacyHome() {
  const { narratives, narrError, signals, hits, stats, clearHistory, fresh, watch, setWatch, graduations, role, workerError, calls, radar, solUsd: sol } =
    useActiveEngine();
  const alerts = useAlerts(signals);
  const solUsd = narratives?.solUsd ?? sol ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Market temperature: how many recent calls (or signals, in narrative mode) reached 2x.
  const settled = signals.filter((s) => now - s.createdAt > 30 * 60_000 && now - s.createdAt < 24 * 3600_000);
  const withPerf = NARRATIVE_ENABLED
    ? settled.map((s) => perf(s)).filter((p): p is { now: number; peak: number } => p !== null)
    : calls.filter((c) => now - c.t > 30 * 60_000 && now - c.t < 24 * 3600_000).map((c) => ({ now: c.now / c.c, peak: c.pk / c.c }));
  const rate = withPerf.length ? withPerf.filter((p) => p.peak >= 2).length / withPerf.length : 0;
  const temperature =
    withPerf.length < 10
      ? { label: "Warming up", rate, n: withPerf.length }
      : { label: rate >= 0.25 ? "Hot" : rate >= 0.12 ? "Warm" : "Cold", rate, n: withPerf.length };

  return (
    <main>
      <Header stats={stats} solUsd={solUsd} alerts={alerts} graduations={graduations} temperature={temperature} radar={NARRATIVE_ENABLED ? undefined : radar} callsToday={NARRATIVE_ENABLED ? undefined : calls.filter((c) => now - c.t < 24 * 3600_000).length} />
      {workerError && (
        <p role="status" className="border-b border-warn/30 bg-warn/10 px-5 py-2 text-sm text-warn md:px-8">
          Cannot reach the signal server ({workerError}). Retrying.
        </p>
      )}
      {role === "standby" && (
        <p role="status" className="border-b border-warn/30 bg-warn/10 px-5 py-2 text-sm text-warn md:px-8">
          The scanner is already running in another tab. This tab shows its signals and takes over if that tab closes.
        </p>
      )}
      {NARRATIVE_ENABLED && (
        <NarrativeWall data={narratives} error={narrError} hits={hits} fresh={fresh} watchWords={watch}>
          <Watchlist words={watch} onChange={setWatch ?? undefined} />
        </NarrativeWall>
      )}
      <TrackRecord signals={signals} now={now} remoteUrl={WORKER_URL || undefined} calls={NARRATIVE_ENABLED ? undefined : calls} />
      <SignalFeed
        signals={signals}
        solUsd={solUsd}
        ready={NARRATIVE_ENABLED ? !!narratives : true}
        onClear={clearHistory ?? undefined}
        calls={NARRATIVE_ENABLED ? undefined : calls}
      />
      {!NARRATIVE_ENABLED && <Archive recent={calls} now={now} remoteUrl={WORKER_URL || undefined} />}
      <SmartMoney remoteUrl={WORKER_URL || undefined} />
      <Heaters remoteUrl={WORKER_URL || undefined} />
      {CALLS_ENABLED && <Calls remoteUrl={WORKER_URL || undefined} />}
      <Report signals={signals} now={now} />
      <footer className="border-t border-line px-5 py-6 text-xs text-muted md:px-8">
        {WORKER_URL
          ? "Signals come from one shared scanner that runs 24/7, everyone sees the same feed."
          : "Scanning runs in this tab while it stays open."}{" "}
        Calls are not financial advice; multiples are market cap at the call to the highest seen after it, not realized profit. Most new tokens go to zero.
      </footer>
    </main>
  );
}
