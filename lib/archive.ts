// Permanent call archive. Every call is kept forever, one storage key per UTC day (a file per day on the
// worker), with the market cap at the call, the peak in the first hour, the peak over 7 days and the latest price.

export interface CallRow {
  m: string; // mint
  n: string; // name
  s: string; // symbol
  img?: string;
  tr: string; // why it was called: graduated, runner, smart (older calls: the radar trigger)
  rt?: string; // radar trigger that first put it on the radar
  why: string; // reason text at call time
  t: number; // call time
  la?: number; // launch time
  c: number; // market cap (USD) at the call
  sc: number; // score at the call
  st?: 1; // strong
  cl?: 1; // clean launch
  sm?: number; // smart wallets among early buyers
  sw?: string[]; // those smart wallets (up to 5)
  p1: number; // highest market cap in the first hour after the call
  pk: number; // highest market cap seen since the call (tracked 7 days)
  now: number; // latest market cap
  chk: number; // last price check
  pool?: string;
  h?: [number, number][]; // market cap series: [minutes since the call, highest mcap in that step]
  pp?: Paper; // paper trade that follows the call with a fixed exit plan
  g?: "solid" | "risky"; // solid: every slow check was in and clean at the call; risky: called before they were
  bc?: string[]; // plain reasons behind the call, at call time
  vol?: number; // latest volume since launch (USD), for the rug check
  bp?: number; // bought in the creation slot by wallets other than the dev, % of supply (launch read)
  sp?: number; // bought by other wallets in the next 3 slots, % of supply (launch read)
  cb?: number; // dev's own first buy, % of supply
  fw?: number; // fresh wallets holding, % of supply, at the call
  lk?: number; // early buyers funded by the dev or a shared funder
}

// Paper trade: what following every call with one fixed, simple exit plan would have returned.
// Buy at the call. Sell half at 2x. Before that, cut everything at 0.6x. After that, sell the rest once it
// falls 35% from its high. Anything still open after 7 days is sold at the last price. Prices are the scanner's
// own readings (every 30 s for the first hour, then every 10 min), so exits land on the first reading past a level.
export interface Paper {
  q: number; // part of the position still open (1, 0.5 or 0)
  x: number; // multiple already banked on the sold part
  hi: number; // highest multiple seen since the call
  tp?: 1; // half sold at 2x
  ex?: "stop" | "trail" | "time"; // why the rest was sold
  at?: number; // when it closed
}

export const PAPER_RULES = { tp: 2, tpPart: 0.5, stop: 0.6, trail: 0.65, maxMs: 7 * 24 * 3600_000 };

export function paperStep(r: CallRow, fdv: number, now: number) {
  if (!(r.c > 0) || !(fdv > 0)) return;
  const p = r.pp ?? (r.pp = { q: 1, x: 0, hi: 1 });
  if (p.q <= 0) return;
  const m = fdv / r.c;
  if (m > p.hi) p.hi = m;
  if (!p.tp && m >= PAPER_RULES.tp) {
    p.x += PAPER_RULES.tpPart * PAPER_RULES.tp; // limit sell at 2x
    p.q -= PAPER_RULES.tpPart;
    p.tp = 1;
  }
  const close = (ex: Paper["ex"]) => {
    p.x += p.q * m;
    p.q = 0;
    p.ex = ex;
    p.at = now;
  };
  if (!p.tp && m <= PAPER_RULES.stop) close("stop");
  else if (p.tp && m <= p.hi * PAPER_RULES.trail) close("trail");
  else if (now - r.t >= PAPER_RULES.maxMs) close("time");
  p.x = Math.round(p.x * 1000) / 1000;
  p.hi = Math.round(p.hi * 1000) / 1000;
}

// Realized multiple of the paper trade, with any open part marked at the latest price.
export function paperValue(r: CallRow): number | null {
  if (!r.pp || !(r.c > 0)) return null;
  return Math.round((r.pp.x + r.pp.q * (r.now / r.c)) * 100) / 100;
}

// Older rows (before paper trades existed): replay their stored price series once.
function backfillPaper(r: CallRow) {
  if (r.pp || !r.h?.length) return;
  r.pp = { q: 1, x: 0, hi: 1 };
  for (const [min, v] of r.h.slice(1)) paperStep(r, v, r.t + min * 60_000);
  if (r.chk > r.t) paperStep(r, r.now, r.chk);
}

// Series step: dense in the first hour, sparse later, so a 7 day chart stays under ~100 points.
const stepFor = (min: number) => (min < 60 ? 2 : min < 360 ? 10 : min < 1440 ? 30 : 240);
const MAX_POINTS = 100;

export function addPoint(r: CallRow, fdv: number, now: number) {
  const min = Math.max(0, Math.round((now - r.t) / 60_000));
  const h = r.h ?? (r.h = [[0, Math.round(r.c)]]);
  const last = h[h.length - 1];
  if (min - last[0] < stepFor(last[0])) {
    // Same step: keep the highest reading so short spikes still show on the chart.
    if (min > 0 && fdv > last[1]) last[1] = Math.round(fdv);
    return;
  }
  h.push([min, Math.round(fdv)]);
  if (h.length > MAX_POINTS) {
    // Thin the older half, keep the first point (entry) and the recent half as is.
    const cut = Math.floor(h.length / 2);
    const older = h.slice(1, cut).filter((_, i) => i % 2 === 1);
    r.h = [h[0], ...older, ...h.slice(cut)];
  }
}

export const TRIGGER_LABEL: Record<string, string> = {
  momentum: "Momentum",
  curve: "Fast curve",
  smart: "Smart money",
  graduated: "Graduated",
  dexpaid: "DEX paid",
  runner: "Runner",
  graduating: "Graduating",
  fresh: "Fresh launch",
  ultra: "Early launch",
};

// Call rows as track record outcomes (peak since the call, up to 7 days).
export function callOutcomes(rows: CallRow[]) {
  return rows.map((r) => ({
    m: r.m,
    s: r.s,
    n: TRIGGER_LABEL[r.tr] ?? r.tr,
    t: r.t,
    e: r.c,
    p: Math.round((r.pk / r.c) * 100) / 100,
    ...(r.st ? { st: 1 as const } : {}),
    ...(r.cl ? { cl: 1 as const } : {}),
    ...(r.sm ? { sm: r.sm } : {}),
    ...(r.img ? { i: r.img } : {}),
    ...(paperValue(r) != null ? { pl: paperValue(r)! } : {}),
    ...(r.g ? { g: r.g } : {}),
  }));
}

interface Store {
  get(k: string): string | null;
  set(k: string, v: string): void;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

// `name` keeps tiers apart on disk: "calls" (the main calls, the default) and "early" (fresh launch calls).
export function createArchive(storage: Store, name = "calls") {
  const INDEX_KEY = `tns.${name}.days`;
  const keyOf = (day: string) => `tns.${name}.${day}`;
  const rows = new Map<string, CallRow>();
  let days: string[] = [];
  const dirty = new Set<string>();

  try {
    days = JSON.parse(storage.get(INDEX_KEY) || "[]");
    for (const d of days)
      for (const r of JSON.parse(storage.get(keyOf(d)) || "[]") as CallRow[]) {
        backfillPaper(r);
        rows.set(r.m, r);
      }
  } catch {
    /* empty archive */
  }

  const touch = (r: CallRow) => dirty.add(dayOf(r.t));

  return {
    has: (mint: string) => rows.has(mint),
    add(r: CallRow) {
      if (rows.has(r.m)) return;
      if (!r.h) r.h = [[0, Math.round(r.c)]];
      if (!r.pp) r.pp = { q: 1, x: 0, hi: 1 };
      rows.set(r.m, r);
      const d = dayOf(r.t);
      if (!days.includes(d)) days.push(d);
      touch(r);
    },
    // New market cap reading for a called token.
    price(mint: string, fdv: number, now = Date.now(), vol?: number) {
      const r = rows.get(mint);
      if (!r || !(fdv > 0)) return;
      r.now = fdv;
      if (vol != null && vol >= 0) r.vol = Math.round(vol);
      // Wall clock of the write (callers may pass the time their fetch started), so live pushes never skip it.
      r.chk = Math.max(now, Date.now());
      if (fdv > r.pk) r.pk = fdv;
      if (now - r.t <= 3600_000 && fdv > r.p1) r.p1 = fdv;
      addPoint(r, fdv, now);
      paperStep(r, fdv, now);
      touch(r);
    },
    // Calls that still need price checks: under 7 days old, not checked for `everyMs`.
    due(everyMs: number, now = Date.now(), trackMs = 7 * 24 * 3600_000) {
      // Paper trades still open after 7 days close at the last price.
      for (const r of rows.values())
        if (r.pp && r.pp.q > 0 && now - r.t >= PAPER_RULES.maxMs) {
          paperStep(r, r.now, now);
          touch(r);
        }
      return [...rows.values()].filter((r) => now - r.t < trackMs && now - r.chk >= everyMs);
    },
    todayCount(now = Date.now()) {
      let n = 0;
      for (const r of rows.values()) if (now - r.t < 24 * 3600_000) n++;
      return n;
    },
    // Calls whose row changed after `since` (new call or new price), for delta updates.
    changedSince(since: number, ms = Infinity, now = Date.now()) {
      return [...rows.values()].filter((r) => (r.t > since || r.chk > since) && now - r.t < ms);
    },
    recent(ms: number, now = Date.now()) {
      return [...rows.values()].filter((r) => now - r.t < ms).sort((a, b) => b.t - a.t);
    },
    page(before: number, limit: number) {
      return [...rows.values()]
        .filter((r) => r.t < before)
        .sort((a, b) => b.t - a.t)
        .slice(0, limit);
    },
    // Fill in fields that arrive after the call (the launch read is history, it can land a few seconds late).
    patch(mint: string, fields: Partial<CallRow>) {
      const r = rows.get(mint);
      if (!r) return;
      Object.assign(r, fields);
      r.chk = Math.max(r.chk, Date.now());
      touch(r);
    },
    get: (mint: string) => rows.get(mint),
    all: () => [...rows.values()],
    size: () => rows.size,
    persist() {
      if (!dirty.size) return;
      const byDay = new Map<string, CallRow[]>();
      for (const r of rows.values()) {
        const d = dayOf(r.t);
        if (!dirty.has(d)) continue;
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(r);
      }
      for (const [d, list] of byDay) storage.set(keyOf(d), JSON.stringify(list));
      storage.set(INDEX_KEY, JSON.stringify(days.sort()));
      dirty.clear();
    },
  };
}

export type Archive = ReturnType<typeof createArchive>;
