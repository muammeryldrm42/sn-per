import { NextResponse } from "next/server";
import { CALLS_ENABLED, channelList, extractMints, type CallPost, type CallsResponse } from "@/lib/calls";
import { UA } from "@/lib/dex";

export const dynamic = "force-dynamic";

const KEEP_MS = 12 * 3600_000;

async function readChannel(name: string): Promise<CallPost[]> {
  const res = await fetch(`https://t.me/s/${name}`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const now = Date.now();
  const out: CallPost[] = [];
  for (const block of html.split('class="tgme_widget_message_wrap').slice(1)) {
    const post = block.match(/data-post="([^"]+)"/)?.[1];
    const time = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
    const at = time ? Date.parse(time) : NaN;
    if (!post || !isFinite(at) || now - at > KEEP_MS) continue;
    // Addresses can sit in the text or only inside links (dexscreener, pump.fun, gmgn...).
    for (const mint of extractMints(block)) out.push({ mint, channel: name, at, post });
  }
  return out;
}

// Recent token calls from the configured public Telegram channels.
export async function GET() {
  const names = CALLS_ENABLED ? channelList() : [];
  const results = await Promise.allSettled(names.map(readChannel));
  const body: CallsResponse = { channels: [], calls: [], updatedAt: Date.now() };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      body.channels.push({ name: names[i], ok: true, posts: r.value.length });
      body.calls.push(...r.value);
    } else {
      body.channels.push({ name: names[i], ok: false, posts: 0, error: String(r.reason?.message || r.reason) });
    }
  });
  return NextResponse.json(body, { headers: { "Cache-Control": "s-maxage=45" } });
}
