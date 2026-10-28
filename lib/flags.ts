// Narrative matching is off: every launch is scanned and picked on what it does on-chain, not on its name.
// Set NEXT_PUBLIC_NARRATIVE=1 to bring the old narrative scanner back (the code is still there).
export const NARRATIVE_ENABLED = process.env.NEXT_PUBLIC_NARRATIVE === "1";

// Call gate. A token on the radar becomes a call only when it clears every rule (see lib/score2.ts).
// Optional extra score floor on top of the gate (0 = off; the live recording showed the score alone does not pick winners).
export const CALL_MIN_SCORE = Number(process.env.NEXT_PUBLIC_CALL_MIN_SCORE || process.env.CALL_MIN_SCORE || 0);
export const CALL_MAX_PER_DAY = Number(process.env.CALL_MAX_PER_DAY || 50);
// Spreads calls over the day instead of spending the daily budget in a few busy hours.
export const CALL_MAX_PER_HOUR = Number(process.env.CALL_MAX_PER_HOUR || 3);
