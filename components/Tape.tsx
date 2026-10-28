"use client";

import { useEffect, useState } from "react";
import type { CallRow } from "@/lib/archive";
import { usd } from "@/lib/format";
import { multText, tick, TokenIcon, TRIGGER_COLOR } from "./ui";

// Scrolling strip of recent calls that ran 2x or more (last 7 days), newest first.
export function Tape({ calls, now, onOpen }: { calls: CallRow[]; now: number; onOpen: (m: string) => void }) {
  const items = calls
    .filter((r) => r.c > 0 && r.pk / r.c >= 2 && now - r.t < 7 * 24 * 3600_000)
    .sort((a, b) => b.t - a.t)
    .slice(0, 24);
  if (!items.length) return null;
  const loop = items.length >= 4 ? [...items, ...items] : items;
  return (
    <div className="card tape mb-4 flex items-center overflow-hidden" aria-label="Recent winners">
      <span className="label flex shrink-0 items-center gap-2 border-r border-line bg-panel px-3 py-2.5 !text-[10px]">
        <span className="pulse h-1.5 w-1.5 rounded-full bg-flow" aria-hidden />
        Winners
      </span>
      <div className="min-w-0 flex-1 overflow-hidden">
        <ul className={`flex w-max ${items.length >= 4 ? "tape-track" : ""}`}>
          {loop.map((r, i) => (
            <li key={`${r.m}-${i}`}>
              <button type="button" onClick={() => onOpen(r.m)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-row">
                <TokenIcon src={r.img} label={r.s} size={18} />
                <span className="font-mono text-[12px] font-bold text-text">${tick(r.s)}</span>
                <span className="font-mono text-[12px] font-bold text-flow">{multText(r.pk / r.c)}</span>
                <span className="font-mono text-[10.5px] text-dim">at {usd(r.c)}</span>
                <span className="h-1 w-1 rounded-full" style={{ background: TRIGGER_COLOR[r.tr] ?? "var(--dim)" }} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const HOW_KEY = "tns.how.v1";

// First-visit explainer, dismissible (remembered in this browser).
export function HowItWorks() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(HOW_KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;
  const steps = [
    ["Watch", "every launch from second one"],
    ["Radar", "movers get the full check"],
    ["Prove", "graduated, 5x run or smart money"],
    ["Safe", "3+ min old, bundle check"],
    ["Call", "logged and tracked forever"],
  ];
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3 border-flow/25 px-4 py-3" style={{ background: "linear-gradient(90deg, #4ade500d, transparent 70%), var(--panel)" }}>
      <p className="mr-2 hidden text-[13.5px] font-semibold text-text sm:block">How a call is made</p>
      <ol className="flex flex-1 flex-wrap items-center gap-1.5 sm:gap-2">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex items-center gap-2">
            <span className="rounded-md border border-line bg-row px-2 py-1 text-[11.5px] sm:px-2.5 sm:text-[12px]">
              <span className="font-mono font-bold text-flow">{i + 1}</span> <span className="font-semibold text-text">{t}</span>{" "}
              <span className="hidden text-muted xl:inline">{d}</span>
            </span>
            {i < steps.length - 1 && <span className="hidden text-dim sm:inline" aria-hidden>→</span>}
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          setShow(false);
          try {
            localStorage.setItem(HOW_KEY, "1");
          } catch {
            /* ignore */
          }
        }}
        className="rounded-md border border-flow/40 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-flow hover:bg-flow/10"
      >
        Got it
      </button>
    </div>
  );
}
