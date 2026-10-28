export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  if (abs >= 1_000) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`;
  if (abs === 0) return "$0";
  return `${sign}$${abs.toPrecision(2)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  const digits = Math.abs(n) >= 100 ? 0 : 1;
  return `${sign}${n.toFixed(digits)}%`;
}

export function fmtX(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(n >= 10 ? 1 : 2)}x`;
}

export function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function shortMint(mint: string): string {
  if (mint.length < 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

export function clsxPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "text-muted";
  return n > 0 ? "text-flow" : "text-warn";
}
