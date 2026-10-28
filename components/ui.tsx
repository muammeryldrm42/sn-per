"use client";

import { useEffect, useRef, useState } from "react";
import { TRIGGER_LABEL } from "@/lib/archive";

// Shared bits for the call terminal: token icon, trigger chip, multiple pill, peak meter, logo.

const HUES = ["#4ade50", "#e0b738", "#7fb3c9", "#b38cff", "#ff8a5c", "#5ad1e8", "#ff6b84"];
const hueOf = (s: string) => HUES[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export function TokenIcon({ src, label, size = 36, ring }: { src?: string; label: string; size?: number; ring?: string }) {
  const [bad, setBad] = useState(false);
  const style = { width: size, height: size };
  if (!src || bad) {
    const c = hueOf(label || "?");
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold"
        style={{ ...style, background: `color-mix(in srgb, ${c} 22%, #0d0e12)`, color: c, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
        aria-hidden
      >
        {(label || "?").replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBad(true)}
      className="shrink-0 rounded-full bg-raise object-cover"
      style={{ ...style, boxShadow: ring ? `0 0 0 2px ${ring}` : undefined }}
    />
  );
}

export const TRIGGER_COLOR: Record<string, string> = {
  momentum: "var(--flow)",
  curve: "var(--steel)",
  smart: "var(--narr)",
  graduated: "var(--violet)",
  dexpaid: "#ff8a5c",
  runner: "#5ad1e8",
  graduating: "#c9a2ff",
  fresh: "#ff9f43",
  ultra: "#b07cff",
};

export function TriggerChip({ trigger, small = false }: { trigger?: string; small?: boolean }) {
  if (!trigger) return null;
  const c = TRIGGER_COLOR[trigger] ?? "var(--muted)";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded font-mono uppercase tracking-wide ${small ? "px-1 py-px text-[9.5px]" : "px-1.5 py-0.5 text-[10px]"}`}
      style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${c} 28%, transparent)` }}
    >
      <TriggerGlyph trigger={trigger} />
      {TRIGGER_LABEL[trigger] ?? trigger}
    </span>
  );
}

function TriggerGlyph({ trigger }: { trigger: string }) {
  const p = { width: 9, height: 9, viewBox: "0 0 10 10", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;
  if (trigger === "momentum") return <svg {...p}><path d="M1 8l3-3 2 2 3-5" /></svg>;
  if (trigger === "curve") return <svg {...p}><path d="M1 9C4 9 6 6 9 1" /></svg>;
  if (trigger === "smart") return <svg {...p}><path d="M5 1l1.2 2.6L9 4l-2 2 .5 3L5 7.6 2.5 9 3 6 1 4l2.8-.4z" /></svg>;
  if (trigger === "graduating") return <svg {...p}><path d="M1 9h6M7 9V3M4 6l3-3 3 3" /></svg>;
  if (trigger === "runner") return <svg {...p}><path d="M5 9V1M2 4l3-3 3 3" /></svg>;
  if (trigger === "graduated") return <svg {...p}><path d="M1 4l4-2 4 2-4 2zM3 5v2.5c1.3 1 2.7 1 4 0V5" /></svg>;
  if (trigger === "fresh" || trigger === "ultra") return <svg {...p}><path d="M6 1L2 6h3l-1 3 4-5H5z" strokeLinejoin="round" /></svg>;
  return <svg {...p}><path d="M2 2h6v6H2z" /></svg>;
}

// Ticker without a leading $ (some tokens put it in the symbol itself).
export const tick = (s?: string) => (s || "?").replace(/^\$+/, "") || "?";

export function multText(x: number) {
  if (!isFinite(x) || x <= 0) return "-";
  if (x >= 100) return `${Math.round(x)}x`;
  if (x >= 10) return `${x.toFixed(1)}x`;
  return `${x.toFixed(2)}x`;
}

// Small pill like "2.67x" under a market cap: green above the call, red below.
export function XPill({ x, className = "" }: { x: number; className?: string }) {
  const up = x >= 1;
  return (
    <span
      className={`inline-block rounded px-1.5 py-px font-mono text-[11px] tabular-nums ${className}`}
      style={{
        color: up ? "var(--flow)" : "var(--warn)",
        background: `color-mix(in srgb, ${up ? "var(--flow)" : "var(--warn)"} 13%, transparent)`,
      }}
    >
      {multText(x)}
    </span>
  );
}

// Ten segment meter for the peak multiple, log scale up to 50x.
export function PeakMeter({ x }: { x: number }) {
  const filled = x <= 1 ? 0 : Math.max(1, Math.min(10, Math.round((Math.log(x) / Math.log(50)) * 10)));
  return (
    <span className="inline-flex gap-[2px]" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className="h-3 w-[3px] rounded-[1px]" style={{ background: i < filled ? "var(--flow)" : "var(--line)" }} />
      ))}
    </span>
  );
}

export function peakColor(x: number) {
  return x >= 2 ? "var(--flow)" : x >= 1.3 ? "var(--text)" : "var(--muted)";
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect width="26" height="26" rx="6" fill="#4ade5014" stroke="#4ade5059" />
        <path d="M7 19C8 13 10 9 13 6" stroke="#4ade50" strokeWidth="2.2" strokeLinecap="round" fill="none" />
        <path d="M11 20c.8-4.5 2.4-8 5-10.5" stroke="#4ade50" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity=".75" />
        <path d="M15.5 20.5c.6-3 1.8-5.5 3.6-7.4" stroke="#4ade50" strokeWidth="2.2" strokeLinecap="round" fill="none" opacity=".5" />
      </svg>
      {!compact && <span className="font-big text-[22px] leading-none tracking-wide text-text">TALONS</span>}
    </span>
  );
}

export function Ext({ href, children, className = "" }: { href: string; children: React.ReactNode; className?: string }) {
  if (!/^https?:\/\//.test(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`rounded-md border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-muted transition-colors hover:border-flow/50 hover:text-text ${className}`}
    >
      {children}
    </a>
  );
}

export function BuyButton({ mint, className = "" }: { mint: string; className?: string }) {
  return (
    <a
      href={`https://jup.ag/swap/SOL-${mint}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-md border border-flow/40 bg-flow/10 px-2.5 py-1.5 font-mono text-[11px] font-bold tracking-wide text-flow transition-colors hover:bg-flow/20 ${className}`}
    >
      BUY
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M3 7l4-4M4 3h3v3" />
      </svg>
    </a>
  );
}

export function ShareButton({ mint }: { mint: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={done ? "Link copied" : "Copy call link"}
      aria-label="Copy call link"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/t/${mint}`);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={`flex h-[30px] w-[30px] items-center justify-center rounded-md border border-line transition-colors hover:border-flow/50 ${done ? "text-flow" : "text-muted hover:text-text"}`}
    >
      {done ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M2 6.5l2.5 2.5L10 3" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="9" cy="2.5" r="1.5" />
          <circle cx="3" cy="6" r="1.5" />
          <circle cx="9" cy="9.5" r="1.5" />
          <path d="M4.3 5.3l3.4-2M4.3 6.7l3.4 2" />
        </svg>
      )}
    </button>
  );
}

// Big page title in the condensed face: first word dim, second bright.
export function PageTitle({ dim, bright, children }: { dim: string; bright: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5 pt-6">
      <h1 className="font-big text-[clamp(34px,4.2vw,56px)] uppercase leading-[0.9]">
        <span className="text-dim">{dim}</span> <span className="text-text">{bright}</span>
      </h1>
      {children}
    </div>
  );
}

export function StatPill({ items }: { items: { value: string; label: string; tone?: "up" | "down" }[] }) {
  return (
    <dl className="card flex divide-x divide-line overflow-hidden">
      {items.map((it) => (
        <div key={it.label} className="px-4 py-2 text-center sm:px-6">
          <dd
            className="font-big text-[24px] leading-none sm:text-[28px]"
            style={{ color: it.tone === "up" ? "var(--flow)" : it.tone === "down" ? "var(--warn)" : "var(--text)" }}
          >
            {it.value}
          </dd>
          <dt className="label mt-1 whitespace-nowrap !text-[9.5px] sm:!text-[10px]">{it.label}</dt>
        </div>
      ))}
    </dl>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string }[];
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={`rounded-md px-2.5 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider transition-colors ${
            value === t.id ? "bg-flow text-[#06210a] shadow-[0_0_18px_-2px_#4ade5047]" : "text-muted hover:bg-raise hover:text-text"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function StarButton({ on, onToggle, size = 30 }: { on: boolean; onToggle: () => void; size?: number }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      title={on ? "In your watchlist" : "Add to your watchlist"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`flex shrink-0 items-center justify-center rounded-md border transition-colors ${
        on ? "border-narr/50 bg-narr/10 text-narr" : "border-line text-dim hover:border-narr/40 hover:text-narr"
      }`}
      style={{ width: size, height: size }}
    >
      <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3">
        <path d="M7 1.2l1.75 3.6 3.95.55-2.86 2.77.68 3.93L7 10.2l-3.52 1.85.68-3.93L1.3 5.35l3.95-.55z" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

const TERMINALS: { name: string; url: (m: string) => string }[] = [
  { name: "Jupiter", url: (m) => `https://jup.ag/swap/SOL-${m}` },
  { name: "Axiom", url: (m) => `https://axiom.trade/t/${m}` },
  { name: "GMGN", url: (m) => `https://gmgn.ai/sol/token/${m}` },
  { name: "BullX", url: (m) => `https://neo.bullx.io/terminal?chainId=1399811149&address=${m}` },
  { name: "Pump.fun", url: (m) => `https://pump.fun/coin/${m}` },
  { name: "DexScreener", url: (m) => `https://dexscreener.com/solana/${m}` },
];

// BUY opens Jupiter; the caret lists the other trading terminals.
export function BuyMenu({ mint, big = false }: { mint: string; big?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pad = big ? "py-2 text-[12px]" : "py-1.5 text-[11px]";
  return (
    <div ref={ref} className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <a
        href={TERMINALS[0].url(mint)}
        target="_blank"
        rel="noopener noreferrer"
        className={`inline-flex items-center gap-1 rounded-l-md border border-flow/40 bg-flow/10 pl-2.5 pr-2 font-mono font-bold tracking-wide text-flow transition-colors hover:bg-flow/20 ${pad} ${big ? "pl-4" : ""}`}
      >
        BUY
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 7l4-4M4 3h3v3" />
        </svg>
      </a>
      <button
        type="button"
        aria-label="More trading terminals"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center rounded-r-md border border-l-0 border-flow/40 bg-flow/10 px-1.5 text-flow transition-colors hover:bg-flow/20 ${pad}`}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M2 4l3 3 3-3" />
        </svg>
      </button>
      {open && (
        <ul className="card absolute right-0 top-[calc(100%+6px)] z-30 w-40 overflow-hidden py-1 shadow-[0_16px_48px_-12px_#000000e6]">
          {TERMINALS.map((t) => (
            <li key={t.name}>
              <a
                href={t.url(mint)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between px-3 py-1.5 font-mono text-[11.5px] text-muted hover:bg-row hover:text-text"
              >
                {t.name} <span aria-hidden>↗</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GradeChip({ g, tr }: { g?: string; tr?: string }) {
  if (tr === "fresh" || tr === "ultra") {
    const c = tr === "fresh" ? "#ff9f43" : "#b07cff";
    return (
      <span
        title={tr === "fresh" ? "Risky tier: fresh launch rule, first 3 minutes. Own track record." : "Ultra risky tier: any healthy launch over $6K in its first 3 minutes. Own track record."}
        className="inline-flex shrink-0 items-center rounded px-1 py-px font-mono text-[9.5px] font-bold uppercase tracking-wide"
        style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 32%, transparent)` }}
      >
        {tr === "fresh" ? "Risky" : "Ultra risky"}
      </span>
    );
  }
  if (!g) return null;
  const solid = g === "solid";
  return (
    <span
      title={solid ? "Wallet read and RugCheck were in and clean at the call" : "Called before every slow check was in, or with a soft warning"}
      className={`inline-flex shrink-0 items-center rounded px-1 py-px font-mono text-[9.5px] font-bold uppercase tracking-wide ${
        solid ? "bg-flow/10 text-flow ring-1 ring-flow/30" : "bg-narr/10 text-narr ring-1 ring-narr/25"
      }`}
    >
      {solid ? "Solid" : "Risky"}
    </span>
  );
}

// Paper trade result in one pill: realized multiple, open or closed.
export function PaperPill({ pp, now, c }: { pp?: { q: number; x: number; ex?: string }; now: number; c: number }) {
  if (!pp || !(c > 0)) return null;
  const v = pp.x + pp.q * (now / c);
  const open = pp.q > 0;
  return (
    <span
      title={open ? "Paper trade still open (marked at the last price)" : `Paper trade closed (${pp.ex ?? "done"})`}
      className="inline-flex items-center gap-1 rounded px-1.5 py-px font-mono text-[10.5px] tabular-nums"
      style={{ color: v >= 1 ? "var(--flow)" : "var(--warn)", background: `color-mix(in srgb, ${v >= 1 ? "var(--flow)" : "var(--warn)"} 10%, transparent)` }}
    >
      P&amp;L {multText(v)}
      <span className="text-dim">{open ? "open" : pp.ex ?? "closed"}</span>
    </span>
  );
}
