import { NextResponse } from "next/server";
import { buildDictionary, type RawEntry } from "@/lib/narrative";
import { lookupTokens, UA } from "@/lib/dex";
import type { SourceStatus } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

function all(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(decode(m[1]));
  return out;
}

async function get(url: string) {
  const res = await fetch(url, {
    headers: UA,
    next: { revalidate: 120 },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const TREND_GEOS = ["US", "GB", "CA", "AU", "IN", "NG", "PH", "SG", "IE"];

// Utility searches and fixtures, not narratives
const TREND_SKIP = /\b(vs|v|weather|forecast|results?|score|scores|live|today|tomorrow|tickets?|schedule|login|near me|lottery|lotto|prediction|standings|how to|what is)\b/i;

// Wikipedia titles that are never a meme narrative
const WIKI_SKIP = /^(Main Page|Special:|Deaths in|List of|Wikipedia:|Portal:|\d{4}\b)/;

type Loader = { id: string; label: string; run: () => Promise<RawEntry[]> };

const loaders: Loader[] = [
  {
    id: "trends",
    label: "Google Trends",
    run: async () => {
      const out: RawEntry[] = [];
      // English speaking and crypto heavy markets. A term trending in several countries sums its weight.
      const xmls = await Promise.allSettled(
        TREND_GEOS.map(async (geo) => (await get(`https://trends.google.com/trending/rss?geo=${geo}`)).text())
      );
      if (!xmls.some((x) => x.status === "fulfilled")) throw new Error("all geos failed");
      for (const [gi, x] of xmls.entries()) {
        if (x.status !== "fulfilled") continue;
        const xml = x.value;
        const geoW = gi < 2 ? 1 : 0.6; // US and GB lead meme culture
        for (const item of xml.split("<item>").slice(1)) {
          const title = all(item, "title")[0];
          const traffic = parseInt((all(item, "ht:approx_traffic")[0] || "0").replace(/\D/g, ""), 10) || 0;
          if (title && !TREND_SKIP.test(title)) {
            out.push({ text: title, kind: "phrase", source: "trends", weight: (3 + Math.log10(1 + traffic)) * geoW });
          }
          for (const h of all(item, "ht:news_item_title")) {
            out.push({ text: h, kind: "headline", source: "trends", weight: 0.8 });
          }
        }
      }
      return out;
    },
  },
  {
    id: "news",
    label: "Google News",
    run: async () => {
      const xml = await (await get("https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en")).text();
      return xml
        .split("<item>")
        .slice(1)
        .map((item) => all(item, "title")[0])
        .filter(Boolean)
        .map((t) => ({ text: t, kind: "headline" as const, source: "news", weight: 1.2 }));
    },
  },
  {
    id: "reddit",
    label: "Reddit",
    run: async () => {
      try {
        const json = await (await get("https://www.reddit.com/r/all/hot.json?limit=75")).json();
        const posts: { data: { title: string } }[] = json?.data?.children ?? [];
        return posts.map((p) => ({ text: p.data.title, kind: "headline" as const, source: "reddit", weight: 1 }));
      } catch {
        // JSON API is often blocked for cloud IPs; the RSS feed sometimes is not.
        const xml = await (await get("https://www.reddit.com/r/all/hot/.rss?limit=75")).text();
        return xml
          .split("<entry>")
          .slice(1)
          .map((e) => all(e, "title")[0])
          .filter(Boolean)
          .map((t) => ({ text: t, kind: "headline" as const, source: "reddit", weight: 1 }));
      }
    },
  },
  {
    id: "wiki",
    label: "Wikipedia most read",
    run: async () => {
      // Yesterday's list is complete; today's is often empty until late UTC.
      const d = new Date(Date.now() - 24 * 3600_000);
      const ymd = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
      const json = await (await get(`https://en.wikipedia.org/api/rest_v1/feed/featured/${ymd}`)).json();
      const arts: { titles: { normalized: string }; views?: number }[] = json?.mostread?.articles ?? [];
      return arts
        .map((a) => a.titles.normalized.replace(/\s*\([^)]*\)\s*$/, "").trim())
        .filter((t) => t && !WIKI_SKIP.test(t))
        .slice(0, 40)
        .map((t, i) => ({ text: t, kind: "phrase" as const, source: "wiki", weight: 4.5 - i * 0.06 }));
    },
  },
  {
    id: "youtube",
    label: "YouTube trending",
    run: async () => {
      const out: RawEntry[] = [];
      const pages = await Promise.allSettled(
        ["us", "gb"].map(async (c) => (await get(`https://kworb.net/youtube/trending/${c}.html`)).text())
      );
      if (!pages.some((p) => p.status === "fulfilled")) throw new Error("kworb unavailable");
      for (const p of pages) {
        if (p.status !== "fulfilled") continue;
        const re = /<a href="https:\/\/youtu\.be\/[^"]+"[^>]*>([^<]+)<\/a>/g;
        let m: RegExpExecArray | null;
        let n = 0;
        while ((m = re.exec(p.value)) && n < 50) {
          out.push({ text: decode(m[1]), kind: "headline", source: "youtube", weight: 1.3 });
          n++;
        }
      }
      return out;
    },
  },
  {
    id: "coingecko",
    label: "CoinGecko trending",
    run: async () => {
      const json = await (await get("https://api.coingecko.com/api/v3/search/trending")).json();
      const coins: { item: { name: string; symbol: string; market_cap_rank?: number | null } }[] = json?.coins ?? [];
      // Skip large caps: a new "Bitcoin" token is a copycat, not a narrative.
      return coins.filter((c) => !c.item.market_cap_rank || c.item.market_cap_rank > 150).map((c) => ({
        text: c.item.name,
        symbol: c.item.symbol,
        kind: "token" as const,
        source: "coingecko",
        weight: 3,
      }));
    },
  },
  {
    id: "gecko",
    label: "GeckoTerminal Solana",
    run: async () => {
      const json = await (await get("https://api.geckoterminal.com/api/v2/networks/solana/trending_pools")).json();
      const pools: { attributes: { name: string } }[] = json?.data ?? [];
      return pools
        .map((p) => (p.attributes?.name || "").split(" / ")[0])
        .filter(Boolean)
        .map((sym) => ({ text: sym, kind: "token" as const, source: "gecko", weight: 3 }));
    },
  },
  {
    id: "dexboost",
    label: "DexScreener boosts",
    run: async () => {
      const boosts: { chainId: string; tokenAddress: string }[] = await (
        await get("https://api.dexscreener.com/token-boosts/top/v1")
      ).json();
      const addrs = (Array.isArray(boosts) ? boosts : [])
        .filter((b) => b.chainId === "solana")
        .map((b) => b.tokenAddress);
      const tokens = await lookupTokens(addrs);
      return tokens.map((t) => ({
        text: t.name,
        symbol: t.symbol,
        kind: "token" as const,
        source: "dexboost",
        weight: 2.5,
      }));
    },
  },
];

async function solPrice(): Promise<number | null> {
  try {
    const j = await (await get("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")).json();
    return typeof j?.solana?.usd === "number" ? j.solana.usd : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const [results, solUsd] = await Promise.all([
    Promise.allSettled(loaders.map((l) => l.run())),
    solPrice(),
  ]);

  const entries: RawEntry[] = [];
  const sources: SourceStatus[] = results.map((r, i) => {
    const l = loaders[i];
    if (r.status === "fulfilled") {
      entries.push(...r.value);
      return { id: l.id, label: l.label, ok: true, count: r.value.length };
    }
    return { id: l.id, label: l.label, ok: false, count: 0, error: String(r.reason?.message || r.reason) };
  });

  return NextResponse.json(
    { terms: buildDictionary(entries), sources, solUsd, updatedAt: Date.now() },
    { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=120" } }
  );
}
