"use client";

// Reads the shared worker instead of scanning in the browser, so every visitor sees the same thing.
// Turned on by NEXT_PUBLIC_WORKER_URL. Live push over Server-Sent Events (/stream); if the stream cannot be
// opened or goes quiet, it falls back to polling /state. Returns the same shape as useEngine.

import { useEffect, useRef, useState } from "react";
import type { EngineStats, NarrativesResponse, Signal } from "./types";
import type { CallRow } from "./archive";
import type { Hit } from "./engine";

const POLL_MS = 2500;
const STREAM_QUIET_MS = 25_000; // the worker sends at least a heartbeat every 15 s

type Mode = "stream" | "poll" | "connecting";

export function useRemoteEngine(base: string) {
  const [narratives, setNarratives] = useState<NarrativesResponse | null>(null);
  const [narrError, setNarrError] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [hits, setHits] = useState<Record<string, Hit>>({});
  const [stats, setStats] = useState<EngineStats>({ ws: "connecting", seen: 0, perMin: 0, matched: 0, unnamedPending: 0 });
  const [fresh, setFresh] = useState<string[]>([]);
  const [watch, setWatchState] = useState<string[]>([]);
  const [graduations, setGraduations] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [early, setEarly] = useState<CallRow[]>([]);
  const [ultra, setUltra] = useState<CallRow[]>([]);
  const [radar, setRadar] = useState(0);
  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>("connecting");
  const map = useRef(new Map<string, Signal>());
  const callMap = useRef(new Map<string, CallRow>());
  const earlyMap = useRef(new Map<string, CallRow>());
  const ultraMap = useRef(new Map<string, CallRow>());

  useEffect(() => {
    let alive = true;
    let since = 0;
    let narrStamp = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let es: EventSource | null = null;
    const url = base.replace(/\/$/, "");

    // One way to apply a payload, from the stream or from polling.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apply = (j: any) => {
      if (j.full) map.current.clear();
      for (const s of (j.signals ?? []) as Signal[]) map.current.set(s.mint, s);
      if (j.mints) {
        const keep = new Set<string>(j.mints);
        for (const k of map.current.keys()) if (!keep.has(k)) map.current.delete(k);
      }
      if (j.serverTime) since = j.serverTime;
      if (j.signals) setSignals([...map.current.values()]);
      if (j.narratives) {
        setNarratives(j.narratives);
        narrStamp = String(j.narratives.updatedAt ?? "");
      }
      if ("narrError" in j) setNarrError(j.narrError ?? null);
      if (j.hits) setHits(j.hits);
      if (j.stats) setStats(j.stats);
      if (j.fresh) setFresh(j.fresh);
      if (j.watch) setWatchState(j.watch);
      if (typeof j.graduations === "number") setGraduations(j.graduations);
      if (j.calls) {
        if (j.full) callMap.current.clear();
        for (const c of j.calls as CallRow[]) callMap.current.set(c.m, c);
        if (j.callMints) {
          const keep = new Set<string>(j.callMints);
          for (const k of callMap.current.keys()) if (!keep.has(k)) callMap.current.delete(k);
        }
        setCalls([...callMap.current.values()].sort((a, b) => b.t - a.t));
      }
      if (j.early) {
        if (j.full) earlyMap.current.clear();
        for (const c of j.early as CallRow[]) earlyMap.current.set(c.m, c);
        if (j.earlyMints) {
          const keep = new Set<string>(j.earlyMints);
          for (const k of earlyMap.current.keys()) if (!keep.has(k)) earlyMap.current.delete(k);
        }
        setEarly([...earlyMap.current.values()].sort((a, b) => b.t - a.t));
      }
      if (j.ultra) {
        if (j.full) ultraMap.current.clear();
        for (const c of j.ultra as CallRow[]) ultraMap.current.set(c.m, c);
        if (j.ultraMints) {
          const keep = new Set<string>(j.ultraMints);
          for (const k of ultraMap.current.keys()) if (!keep.has(k)) ultraMap.current.delete(k);
        }
        setUltra([...ultraMap.current.values()].sort((a, b) => b.t - a.t));
      }
      if (typeof j.radar === "number") setRadar(j.radar);
      if (typeof j.solUsd === "number") setSolUsd(j.solUsd);
      setWorkerError(null);
    };

    const poll = async () => {
      try {
        const q = since ? `?since=${since}&narr=${narrStamp}` : "";
        const r = await fetch(`${url}/state${q}`, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 503 ? "worker is starting" : `worker HTTP ${r.status}`);
        const j = await r.json();
        if (!alive) return;
        apply(j);
      } catch (e) {
        if (!alive) return;
        setWorkerError((e as Error).message || "worker unreachable");
        setStats((s) => ({ ...s, ws: "closed" }));
      }
      if (alive) timer = setTimeout(poll, document.hidden ? POLL_MS * 4 : POLL_MS);
    };

    const startPolling = () => {
      es?.close();
      es = null;
      if (!alive) return;
      setMode("poll");
      clearTimeout(timer);
      poll();
      // Try the stream again in a minute; polling keeps everything up to date meanwhile.
      watchdog = setTimeout(() => {
        if (!alive) return;
        clearTimeout(timer);
        startStream();
      }, 60_000);
    };

    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(startPolling, STREAM_QUIET_MS);
    };

    const startStream = () => {
      if (typeof EventSource === "undefined") return startPolling();
      setMode("connecting");
      es = new EventSource(`${url}/stream${since ? `?since=${since}` : ""}`);
      arm();
      es.addEventListener("state", (e) => {
        if (!alive) return;
        setMode("stream");
        arm();
        try {
          apply(JSON.parse((e as MessageEvent).data));
        } catch {
          /* bad frame, wait for the next */
        }
      });
      es.addEventListener("stats", (e) => {
        if (!alive) return;
        arm();
        try {
          apply(JSON.parse((e as MessageEvent).data));
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        if (!alive) return;
        setStats((s) => ({ ...s, ws: "closed" }));
        // The browser retries by itself (and resumes from Last-Event-ID); the watchdog falls back to polling.
      };
    };

    startStream();
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(watchdog);
      es?.close();
    };
  }, [base]);

  return {
    narratives,
    narrError,
    signals,
    hits,
    stats,
    fresh,
    watch,
    graduations,
    workerError,
    calls,
    early,
    ultra,
    radar,
    solUsd,
    link: mode,
    role: "leader" as const,
    // History and the watchlist live on the worker and are the same for everyone.
    clearHistory: null as null | (() => void),
    setWatch: null as null | ((w: string[]) => void),
  };
}

// One tier's board from the worker (/feed): the whole range once, then only the rows that changed, every few
// seconds. The risky and ultra risky tiers run to hundreds of calls a day, too many for the live stream.
export function useTierFeed(base: string | undefined, tier: string, range: "24h" | "7d", enabled: boolean) {
  const [rows, setRows] = useState<CallRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!base || !enabled) return;
    let alive = true;
    let since = 0;
    const map = new Map<string, CallRow>();
    const span = range === "7d" ? 7 * 24 * 3600_000 : 24 * 3600_000;
    setRows([]);
    setLoaded(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await fetch(`${base.replace(/\/$/, "")}/feed?tier=${tier}&range=${range}${since ? `&since=${since}` : ""}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { serverTime: number; full: boolean; rows: CallRow[]; total: number };
          if (!alive) return;
          if (j.full) map.clear();
          for (const row of j.rows) map.set(row.m, row);
          const now = Date.now();
          for (const [k, v] of map) if (now - v.t > span) map.delete(k);
          since = j.serverTime;
          setRows([...map.values()].sort((a, b) => b.t - a.t));
          setTotal(j.total);
          setLoaded(true);
        }
      } catch {
        /* next round */
      }
      if (alive) timer = setTimeout(load, document.hidden ? 20_000 : 4_000);
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [base, tier, range, enabled]);
  return { rows, total, loaded };
}
