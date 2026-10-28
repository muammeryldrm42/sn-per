// Public lab: every rule we use, and every rule we are considering, measured the same way on live data.
// A rule "fires" the first time a radar token passes it (with a price under 90 s old). From that moment its market
// cap is followed for 45 minutes: peak, low, where it ended, and the paper trade with the same exit plan as the
// calls. No caps, no picking: every fire counts. Live rules are only changed when a variant beats them here on
// enough fires, and every change is written in the changelog.
import type { Signal } from "./types";
import { PAPER_RULES } from "./archive";
import { callBlockers, callGrade, callPath, earlyBlockers, ultraAllBlockers, ultraBlockers } from "./score2";

export const LAB_HORIZON_MS = 45 * 60_000;
export const COST_ROUND_TRIP = 0.025; // ~1.25% fee each way on pump.fun plus a little slippage, for "net" numbers

export interface LabRule {
  id: string;
  label: string;
  live: boolean; // a tier the site calls on (uncapped here), or a variant being measured
  note: string;
  test: (s: Signal, now: number) => boolean;
}

const balanced = (s: Signal, now: number) =>
  now - (s.promotedAt ?? s.createdAt) < 60 * 60_000 && !!callPath(s, now) && callBlockers(s, now).length === 0;
const risky = (s: Signal, now: number) => earlyBlockers(s, now).length === 0;
const ultra = (s: Signal, now: number) => ultraBlockers(s, now).length === 0;
const clean = (s: Signal, max: number) => !!s.launch && s.launch.bundlePct < max && s.launch.snipedPct < max;

export const LAB_RULES: LabRule[] = [
  { id: "conservative", label: "Conservative", live: true, note: "Balanced, with the wallet read and RugCheck in and clean", test: (s, n) => balanced(s, n) && callGrade(s) === "solid" },
  { id: "balanced", label: "Balanced", live: true, note: "Graduated, 5x runner or smart money, every health and anti-rug check", test: balanced },
  { id: "risky", label: "Risky", live: true, note: "First 3 min on the curve, curve 65% or less, buys 1.5x sells, dev buy under 1 SOL", test: risky },
  { id: "ultra", label: "Ultra risky", live: true, note: "First 3 min, 2x+ since launch, more buys than sells, curve 80% or less, dev buy under 1 SOL", test: ultra },
  { id: "ultra_all", label: "Ultra, every launch", live: false, note: "The first ultra rule: every healthy launch over $6K in its first 3 min (replaced, kept for comparison)", test: (s, n) => ultraAllBlockers(s, n).length === 0 },
  { id: "ultra_clean", label: "Ultra + clean launch", live: false, note: "Ultra, and under 10% bundled and under 10% sniped at launch", test: (s, n) => ultra(s, n) && clean(s, 10) },
  { id: "ultra_bundled", label: "Ultra, bundled launch", live: false, note: "Ultra calls where 10%+ was bundled with the create (is the bundle a rug sign?)", test: (s, n) => ultra(s, n) && !!s.launch && s.launch.bundlePct >= 10 },
  { id: "risky_clean", label: "Risky + clean launch", live: false, note: "Risky, and under 10% bundled and under 10% sniped at launch", test: (s, n) => risky(s, n) && clean(s, 10) },
  { id: "gem_launch", label: "Gem launch", live: false, note: "First 3 min over $6K, healthy, under 5% bundled, under 5% sniped, dev buy under 5%", test: (s, n) => ultraAllBlockers(s, n).length === 0 && clean(s, 5) && (s.launch?.devPct ?? 100) < 5 },
  { id: "graduated", label: "Graduated path", live: false, note: "Balanced calls made on graduation", test: (s, n) => balanced(s, n) && callPath(s, n) === "graduated" },
  { id: "runner", label: "Runner path", live: false, note: "Balanced calls made on a 5x run", test: (s, n) => balanced(s, n) && callPath(s, n) === "runner" },
  { id: "smart", label: "Smart money path", live: false, note: "Balanced calls made on 2+ smart wallets or KOLs", test: (s, n) => balanced(s, n) && callPath(s, n) === "smart" },
  { id: "balanced_age5", label: "Balanced, 5 min+", live: false, note: "Balanced, only tokens at least 5 min old", test: (s, n) => balanced(s, n) && n - s.createdAt >= 5 * 60_000 },
  {
    id: "balanced_rugcheck",
    label: "Balanced + RugCheck clean",
    live: false,
    note: "Balanced, with the RugCheck report in and no danger flag",
    test: (s, n) => balanced(s, n) && s.rug.status === "ok" && !s.rug.risks.some((r) => r.level === "danger"),
  },
  {
    id: "dexpaid_young",
    label: "DEX paid early",
    live: false,
    note: "Paid DexScreener profile within 15 min of launch, $10K+, more buys than sells, not junk",
    test: (s, n) => !!s.dexPaid && n - s.createdAt < 15 * 60_000 && (s.fdvUsd ?? 0) >= 10_000 && !s.junk && (s.m5Buys ?? 0) > (s.m5Sells ?? 0),
  },
];

interface Paper {
  q: number;
  x: number;
  hi: number;
  tp?: 1;
}
export interface LabFire {
  r: string; // rule id
  m: string; // mint
  s: string; // symbol
  t: number; // fired at
  c: number; // market cap at the fire
  pk: number; // highest since
  mn: number; // lowest since
  last: number; // last reading within the horizon
  lt: number; // when
  pp: Paper;
  done?: 1;
}

function paperStep(p: Paper, m: number) {
  if (p.q <= 0) return;
  if (m > p.hi) p.hi = m;
  if (!p.tp && m >= PAPER_RULES.tp) {
    p.x += PAPER_RULES.tpPart * PAPER_RULES.tp;
    p.q -= PAPER_RULES.tpPart;
    p.tp = 1;
  }
  if (!p.tp && m <= PAPER_RULES.stop) {
    p.x += p.q * m;
    p.q = 0;
  } else if (p.tp && m <= p.hi * PAPER_RULES.trail) {
    p.x += p.q * m;
    p.q = 0;
  }
}
const paperValue = (f: LabFire) => f.pp.x + f.pp.q * (f.last / f.c);

interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
const KEEP_DAYS = 30;

export interface LabStat {
  id: string;
  label: string;
  live: boolean;
  note: string;
  n: number; // settled fires
  open: number;
  perDay: number;
  hit15: number;
  hit2: number;
  hit3: number;
  hit2Low: number; // 95% range of the 2x rate (Wilson)
  hit2High: number;
  rug: number; // ended under 0.2x of the fire at 45 min
  medPeak: number;
  paper: number; // average paper trade multiple, before costs
  paperNet: number; // after ~2.5% round-trip costs
  win: number; // paper trades that made money after costs
}

function wilson(k: number, n: number) {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

export function createLab(storage: Store, rules = LAB_RULES) {
  const fires = new Map<string, LabFire>(); // `${rule}|${mint}`
  const open = new Map<string, LabFire[]>(); // mint -> unsettled fires
  const dirty = new Set<string>();
  let days: string[] = [];
  const started = Date.now();
  try {
    days = JSON.parse(storage.get("tns.lab.days") || "[]");
    const cutoff = dayOf(Date.now() - KEEP_DAYS * 86_400_000);
    days = days.filter((d) => d >= cutoff);
    for (const d of days)
      for (const f of JSON.parse(storage.get(`tns.lab.${d}`) || "[]") as LabFire[]) {
        // Fires left open by a restart are settled with what was seen.
        if (!f.done) f.done = 1;
        fires.set(`${f.r}|${f.m}`, f);
      }
  } catch {
    /* fresh lab */
  }
  const touch = (f: LabFire) => {
    const d = dayOf(f.t);
    dirty.add(d);
    if (!days.includes(d)) days.push(d);
  };

  return {
    rules,
    // Called once per scoring pass for every radar token with a fresh price.
    observe(s: Signal, now: number) {
      const mc = s.fdvUsd ?? 0;
      if (!(mc > 0)) return;
      for (const r of rules) {
        const key = `${r.id}|${s.mint}`;
        if (fires.has(key)) continue;
        let ok = false;
        try {
          ok = r.test(s, now);
        } catch {
          ok = false;
        }
        if (!ok) continue;
        const f: LabFire = { r: r.id, m: s.mint, s: s.symbol, t: now, c: mc, pk: mc, mn: mc, last: mc, lt: now, pp: { q: 1, x: 0, hi: 1 } };
        fires.set(key, f);
        const list = open.get(s.mint) ?? [];
        list.push(f);
        open.set(s.mint, list);
        touch(f);
      }
    },
    price(mint: string, fdv: number, now: number) {
      const list = open.get(mint);
      if (!list || !(fdv > 0)) return;
      for (const f of list) {
        if (f.done || now - f.t > LAB_HORIZON_MS || now <= f.t) continue;
        if (fdv / f.c > 300) continue; // bogus print
        f.pk = Math.max(f.pk, fdv);
        f.mn = Math.min(f.mn, fdv);
        f.last = fdv;
        f.lt = now;
        paperStep(f.pp, fdv / f.c);
        touch(f);
      }
    },
    // Settle fires past the horizon.
    sweep(now: number) {
      for (const [m, list] of open) {
        for (const f of list)
          if (!f.done && now - f.t > LAB_HORIZON_MS) {
            f.done = 1;
            touch(f);
          }
        const rest = list.filter((f) => !f.done);
        if (rest.length) open.set(m, rest);
        else open.delete(m);
      }
    },
    hasOpen: (mint: string) => open.has(mint),
    stats(rangeMs: number, now = Date.now()) {
      const out: LabStat[] = [];
      let first = started;
      for (const f of fires.values()) if (f.t < first) first = f.t;
      const span = Math.min(rangeMs, now - first);
      for (const r of rules) {
        const all = [...fires.values()].filter((f) => f.r === r.id && now - f.t <= rangeMs);
        // Settled, and priced at least once after the fire (a token that vanished is not a result).
        const done = all.filter((f) => f.done && f.lt > f.t);
        const n = done.length;
        const pct = (k: number) => (n ? Math.round((k / n) * 1000) / 10 : 0);
        const k2 = done.filter((f) => f.pk / f.c >= 2).length;
        const [lo, hi] = wilson(k2, n);
        const peaks = done.map((f) => f.pk / f.c).sort((a, b) => a - b);
        const papers = done.map(paperValue);
        const avg = papers.length ? papers.reduce((a, b) => a + b, 0) / papers.length : 0;
        out.push({
          id: r.id,
          label: r.label,
          live: r.live,
          note: r.note,
          n,
          open: all.length - done.length,
          perDay: span > 0 ? Math.round((all.length / span) * 86_400_000) : 0,
          hit15: pct(done.filter((f) => f.pk / f.c >= 1.5).length),
          hit2: pct(k2),
          hit3: pct(done.filter((f) => f.pk / f.c >= 3).length),
          hit2Low: Math.round(lo * 1000) / 10,
          hit2High: Math.round(hi * 1000) / 10,
          rug: pct(done.filter((f) => f.last / f.c < 0.2).length),
          medPeak: peaks.length ? Math.round(peaks[Math.floor(peaks.length / 2)] * 100) / 100 : 0,
          paper: Math.round(avg * 1000) / 1000,
          paperNet: Math.round(avg * (1 - COST_ROUND_TRIP) * 1000) / 1000,
          win: pct(papers.filter((v) => v * (1 - COST_ROUND_TRIP) > 1).length),
        });
      }
      return out;
    },
    // Recent fires of one rule, newest first (for the lab page).
    recent(rule: string, limit = 30) {
      return [...fires.values()]
        .filter((f) => f.r === rule)
        .sort((a, b) => b.t - a.t)
        .slice(0, limit)
        .map((f) => ({ m: f.m, s: f.s, t: f.t, c: Math.round(f.c), peak: Math.round((f.pk / f.c) * 100) / 100, end: Math.round((f.last / f.c) * 100) / 100, done: !!f.done }));
    },
    persist() {
      if (!dirty.size) return;
      const byDay = new Map<string, LabFire[]>();
      for (const f of fires.values()) {
        const d = dayOf(f.t);
        if (!dirty.has(d)) continue;
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(f);
      }
      for (const [d, list] of byDay) storage.set(`tns.lab.${d}`, JSON.stringify(list));
      const cutoff = dayOf(Date.now() - KEEP_DAYS * 86_400_000);
      days = days.filter((d) => d >= cutoff).sort();
      storage.set("tns.lab.days", JSON.stringify(days));
      dirty.clear();
      // Drop fires past the kept window from memory.
      const minT = Date.now() - KEEP_DAYS * 86_400_000;
      for (const [k, f] of fires) if (f.t < minT) fires.delete(k);
    },
    size: () => fires.size,
  };
}

export type Lab = ReturnType<typeof createLab>;
