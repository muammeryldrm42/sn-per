export function age(ts: number, now: number) {
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function usd(n: number | undefined | null) {
  if (n == null || !isFinite(n)) return "-";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function sol(n: number) {
  if (!isFinite(n)) return "-";
  const a = Math.abs(n);
  const v = a >= 100 ? n.toFixed(0) : a >= 1 ? n.toFixed(2) : n.toFixed(3);
  return `${v} SOL`;
}

export function short(addr: string) {
  return addr.length > 10 ? `${addr.slice(0, 4)}...${addr.slice(-4)}` : addr;
}

export function pct(n: number | undefined) {
  if (n == null || !isFinite(n)) return "-";
  return `${n >= 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}

// Current and peak multiple since the signal fired.
export function perf(s: {
  marketCapSol: number;
  mcapAtSignal?: number;
  peakMcapSol?: number;
  fdvUsd?: number;
  fdvAtSignal?: number;
  peakFdvUsd?: number;
}): { now: number; peak: number } | null {
  if (s.mcapAtSignal && s.marketCapSol) {
    return { now: s.marketCapSol / s.mcapAtSignal, peak: (s.peakMcapSol ?? s.marketCapSol) / s.mcapAtSignal };
  }
  if (s.fdvAtSignal && s.fdvUsd) {
    return { now: s.fdvUsd / s.fdvAtSignal, peak: (s.peakFdvUsd ?? s.fdvUsd) / s.fdvAtSignal };
  }
  return null;
}

export function mult(x: number) {
  return `${x >= 10 ? x.toFixed(0) : x.toFixed(2)}x`;
}
