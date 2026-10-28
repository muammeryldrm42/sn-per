import { TRIGGER_LABEL } from "./archive";

// Track record over a time range, from slim outcome rows kept by the shared worker.
export interface Outcome {
  m: string; // mint
  s: string; // symbol
  n: string; // narrative
  t: number; // signal time
  e?: number; // entry market cap (USD) at the signal
  p: number; // peak multiple since the signal
  st?: 1; // strong
  cl?: 1; // clean launch
  ri?: 1; // went rising
  sm?: number; // smart wallets among early buyers
  i?: string; // token image
  pl?: number; // paper trade multiple (realized, open part marked to market)
  g?: string; // grade at the call: solid or risky
}

export interface RecordStats {
  range: string;
  n: number;
  hits: Record<string, number>; // "2" -> count reaching 2x, ...
  median: number;
  groups: { label: string; n: number; x2: number; x3: number }[];
  best: Outcome[];
  avg?: number; // mean peak multiple (pulled up by the big winners; the median is the typical call)
  daily?: { d: string; n: number; avg: number; med: number; best: number; x2: number }[]; // newest first, up to 30 days
  paper?: { n: number; avg: number; med: number; win: number; pnl100: number }; // following every call with the paper plan, $100 each
  hours?: { n: number; x2: number }[]; // by UTC hour of the call (24 entries)
}

export const RANGES: Record<string, number> = { "24h": 24 * 3600_000, "7d": 7 * 24 * 3600_000, "30d": 30 * 24 * 3600_000, all: Infinity };
const STEPS = [1.2, 1.5, 2, 3, 5, 10, 25, 50, 100];

export function computeRecord(rows: Outcome[], range: string, now = Date.now()): RecordStats {
  const span = RANGES[range] ?? RANGES["24h"];
  // Calls under 30 min old have not had time to play out; they would only drag the rates down.
  const list = rows.filter((r) => now - r.t <= span && now - r.t >= 30 * 60_000);
  const hits: Record<string, number> = {};
  for (const x of STEPS) hits[x] = list.filter((r) => r.p >= x).length;
  const peaks = list.map((r) => r.p).sort((a, b) => a - b);
  const g = (label: string, l: Outcome[]) => ({ label, n: l.length, x2: l.filter((r) => r.p >= 2).length, x3: l.filter((r) => r.p >= 3).length });
  return {
    range,
    n: list.length,
    hits,
    median: peaks.length ? peaks[Math.floor(peaks.length / 2)] : 0,
    groups: [
      g("All signals", list),
      g("Strong", list.filter((r) => r.st)),
      g("Clean launch", list.filter((r) => r.cl)),
      g("Went rising", list.filter((r) => r.ri)),
      g("Smart wallets bought early", list.filter((r) => (r.sm ?? 0) > 0)),
      // On-chain calls carry their trigger label in `n`.
      ...Object.values(TRIGGER_LABEL).map((label) => g(`Type: ${label}`, list.filter((r) => r.n === label))),
      g("Grade: Solid", list.filter((r) => r.g === "solid")),
      g("Grade: Risky", list.filter((r) => r.g === "risky")),
    ].filter((x) => x.n > 0),
    best: [...list].sort((a, b) => b.p - a.p).slice(0, 10),
    avg: peaks.length ? Math.round((peaks.reduce((a, b) => a + b, 0) / peaks.length) * 100) / 100 : 0,
    daily: dailyOf(list),
    paper: paperOf(list),
    hours: Array.from({ length: 24 }, (_, h) => {
      const l = list.filter((r) => new Date(r.t).getUTCHours() === h);
      return { n: l.length, x2: l.filter((r) => r.p >= 2).length };
    }),
  };
}

// Per UTC day: how many calls, average and median peak, best call, how many reached 2x.
function dailyOf(list: Outcome[]) {
  const by = new Map<string, number[]>();
  for (const r of list) {
    const d = new Date(r.t).toISOString().slice(0, 10);
    if (!by.has(d)) by.set(d, []);
    by.get(d)!.push(r.p);
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 30)
    .map(([d, ps]) => {
      const sorted = [...ps].sort((a, b) => a - b);
      return {
        d,
        n: ps.length,
        avg: Math.round((ps.reduce((a, b) => a + b, 0) / ps.length) * 100) / 100,
        med: sorted[Math.floor(sorted.length / 2)],
        best: sorted[sorted.length - 1],
        x2: ps.filter((p) => p >= 2).length,
      };
    });
}

// Paper trades: average and median result per call, how many made money, and the total if each call got $100.
function paperOf(list: Outcome[]) {
  const pl = list.map((r) => r.pl).filter((x): x is number => typeof x === "number");
  if (!pl.length) return undefined;
  const sorted = [...pl].sort((a, b) => a - b);
  return {
    n: pl.length,
    avg: Math.round((pl.reduce((a, b) => a + b, 0) / pl.length) * 100) / 100,
    med: sorted[Math.floor(sorted.length / 2)],
    win: pl.filter((x) => x > 1).length,
    pnl100: Math.round(pl.reduce((a, b) => a + (b - 1) * 100, 0)),
  };
}
