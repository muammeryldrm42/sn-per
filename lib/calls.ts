// Calls from public Telegram channels (t.me/s/<channel> web preview, no key, no bot).
// Add the public channel usernames you want to follow here, or set CALL_CHANNELS="a,b,c" in .env.
export const DEFAULT_CHANNELS: string[] = [];

// Telegram calls are on hold: off unless NEXT_PUBLIC_CALLS_ENABLED=1. The code stays in place.
export const CALLS_ENABLED = process.env.NEXT_PUBLIC_CALLS_ENABLED === "1";

export interface CallPost {
  mint: string;
  channel: string;
  at: number;
  post: string;
}

export interface CallsResponse {
  channels: { name: string; ok: boolean; posts: number; error?: string }[];
  calls: CallPost[];
  updatedAt: number;
}

// Addresses that show up in posts but are never the called token.
const NOT_TOKENS = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "11111111111111111111111111111111",
]);

const B58 = /(?<![1-9A-HJ-NP-Za-km-z])[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g;
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// A real Solana address decodes to exactly 32 bytes.
function is32Bytes(s: string): boolean {
  let bytes = [0];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) return false;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  bytes = bytes.reverse();
  return bytes.length === 32;
}

export function extractMints(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.match(B58) ?? []) {
    if (NOT_TOKENS.has(m) || !is32Bytes(m)) continue;
    out.add(m);
  }
  return [...out];
}

export function channelList(): string[] {
  const env = (process.env.CALL_CHANNELS || "").split(",");
  return [...new Set([...DEFAULT_CHANNELS, ...env].map((c) => c.trim().replace(/^@|^https?:\/\/t\.me\/(s\/)?/i, "")).filter((c) => /^[A-Za-z0-9_]{4,64}$/.test(c)))];
}
