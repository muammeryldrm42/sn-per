"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CallRow } from "@/lib/archive";
import { age, usd } from "@/lib/format";
import { tick, TokenIcon } from "./ui";

const READ_KEY = "tns.noticeRead.v1";
const STEPS = [2, 3, 5, 10, 25, 50, 100];

interface Notice {
  key: string;
  t: number;
  mint: string;
  sym: string;
  img?: string;
  kind: "call" | "hit";
  title: string;
  body: string;
}

// Every new call and every multiple a call reaches (2x, 3x, 5x ...), newest first.
function noticesOf(calls: CallRow[], now: number): Notice[] {
  const out: Notice[] = [];
  for (const r of calls) {
    out.push({ key: `c${r.m}`, t: r.t, mint: r.m, sym: r.s, img: r.img, kind: "call", title: `$${tick(r.s)} · new call`, body: `Called at ${usd(r.c)} market cap` });
    for (const k of STEPS) {
      const p = r.h?.find((pt) => pt[1] >= r.c * k);
      if (!p) break;
      out.push({
        key: `h${r.m}${k}`,
        t: r.t + p[0] * 60_000,
        mint: r.m,
        sym: r.s,
        img: r.img,
        kind: "hit",
        title: `$${tick(r.s)} · ${k}x since the call`,
        body: `${usd(r.c)} to ${usd(r.c * k)}+`,
      });
    }
  }
  return out.filter((n) => n.t <= now + 60_000).sort((a, b) => b.t - a.t).slice(0, 50);
}

// Bell in the top bar: unread count, the notice list, and the sound/notification switch.
export function Notices({
  calls,
  alerts,
  onOpen,
}: {
  calls: CallRow[];
  alerts: { enabled: boolean; toggle: () => void; permission: string };
  onOpen: (mint: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [readAt, setReadAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      setReadAt(Number(localStorage.getItem(READ_KEY) || 0) || Date.now() - 6 * 3600_000);
    } catch {
      setReadAt(Date.now() - 6 * 3600_000);
    }
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const list = useMemo(() => noticesOf(calls, now), [calls, now]);
  const unread = list.filter((n) => n.t > readAt).length;

  const markRead = () => {
    const t = Date.now();
    setReadAt(t);
    try {
      localStorage.setItem(READ_KEY, String(t));
    } catch {
      /* ignore */
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setTimeout(markRead, 1500);
        }}
        aria-expanded={open}
        aria-label={`Notifications${unread ? `, ${unread} new` : ""}`}
        className={`relative flex h-8 w-9 items-center justify-center rounded-md border transition-colors ${
          open ? "border-flow/50 text-text" : "border-line text-muted hover:text-text"
        }`}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
          <path d="M3.5 10V6.5a3.5 3.5 0 017 0V10l1 1.2h-9zM5.8 12.5a1.3 1.3 0 002.4 0" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-flow px-1 font-mono text-[9.5px] font-bold leading-[16px] text-[#06210a]">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 top-[42px] z-40 w-[min(360px,calc(100vw-24px))] overflow-hidden shadow-[0_16px_48px_-12px_#000000e6]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="label !text-[10px]">Notifications</span>
            <button
              type="button"
              onClick={alerts.toggle}
              aria-pressed={alerts.enabled}
              title={alerts.permission === "denied" ? "Browser notifications are blocked for this site, the sound still plays" : "Sound and a browser notification on every new call"}
              className={`rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider ${alerts.enabled ? "bg-flow/15 text-flow" : "text-muted hover:text-text"}`}
            >
              {alerts.enabled ? "Sound on" : "Sound off"}
            </button>
          </div>
          {list.length === 0 ? (
            <p className="px-3 py-6 text-center font-mono text-[11.5px] text-muted">No calls yet. They show up here the moment they land.</p>
          ) : (
            <ul className="scroll-thin max-h-[420px] overflow-y-auto">
              {list.map((n) => (
                <li key={n.key} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpen(n.mint);
                    }}
                    className={`flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-row ${n.t > readAt ? "bg-flow/[0.04]" : ""}`}
                  >
                    <TokenIcon src={n.img} label={n.sym} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[12.5px] font-semibold ${n.kind === "hit" ? "text-flow" : "text-text"}`}>{n.title}</span>
                      <span className="block truncate font-mono text-[10.5px] text-muted">{n.body}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-dim">{age(n.t, now)}</span>
                    {n.t > readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-flow" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

