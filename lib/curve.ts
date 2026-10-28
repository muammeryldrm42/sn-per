// pump.fun bonding curve math (constant product on virtual reserves).
// Start: 30 virtual SOL, 1.073B virtual tokens. Graduation after 793.1M real tokens are sold (~411 SOL mcap).
const V_SOL0 = 30;
const V_TOK0 = 1_073_000_000;
const K = V_SOL0 * V_TOK0;
const SELLABLE = 793_100_000;

// Curve progress (0..100) from market cap in SOL, for a 1B supply pump.fun token.
export function curveFromMcapSol(mcapSol: number): number | undefined {
  if (!isFinite(mcapSol) || mcapSol <= 0) return undefined;
  const vSol = Math.sqrt((K * mcapSol) / 1e9);
  const vTok = K / vSol;
  return Math.max(0, Math.min(100, ((V_TOK0 - vTok) / SELLABLE) * 100));
}
