"use client";

import { useState } from "react";

export function Watchlist({ words, onChange }: { words: string[]; onChange?: (w: string[]) => void }) {
  const [text, setText] = useState("");
  if (!onChange) {
    // Shared mode: the watchlist is set on the server (WATCHLIST env) and is the same for everyone.
    return words.length ? (
      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">Watchlist</span>
        {words.map((w) => (
          <span key={w} className="rounded-full border border-narr/40 px-2.5 py-0.5 text-narr">
            {w}
          </span>
        ))}
      </div>
    ) : null;
  }
  const add = () => {
    const parts = text
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange?.([...words, ...parts]);
    setText("");
  };
  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="watch-input" className="text-sm font-semibold">
          Your watchlist
        </label>
        <input
          id="watch-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add words, comma separated"
          className="w-56 rounded-md border border-line bg-panel px-2.5 py-1 text-sm placeholder:text-muted"
        />
        <button type="button" onClick={add} className="rounded-md border border-line px-3 py-1 text-sm hover:border-narr">
          Add
        </button>
      </div>
      {words.length === 0 ? (
        <p className="mt-2 text-xs text-muted">
          Words you add are matched like trending narratives, so you catch launches on themes you expect before they trend.
        </p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {words.map((w) => (
            <li key={w} className="flex items-center gap-1 rounded-full border border-narr/40 py-0.5 pl-2.5 pr-1 text-sm text-narr">
              {w}
              <button
                type="button"
                aria-label={`Remove ${w}`}
                onClick={() => onChange?.(words.filter((x) => x !== w))}
                className="rounded-full px-1.5 text-muted hover:text-text"
              >
                x
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
