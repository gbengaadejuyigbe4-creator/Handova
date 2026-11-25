/**
 * nextStep.ts — which tool Home should put first.
 *
 * Uses only the saved history, not the clock of the day, because shift hours vary.
 *  - If the latest planner entry is newer than the latest report, and recent
 *    (within PLAN_FRESH_HOURS), the nurse is mid-shift: Report is next.
 *  - Otherwise: Planner is next (new shift, or nothing saved yet).
 * A day shift (plan 07:30, report 19:30) and a night shift (plan 19:30,
 * report 07:30) both resolve correctly, because only the order matters.
 */

export const PLAN_FRESH_HOURS = 16;

export type NextStep = "planner" | "report";

const toMs = (iso?: string): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

const latest = (entries: ReadonlyArray<{ savedAt?: string }>): number =>
  entries.reduce((max, e) => Math.max(max, toMs(e.savedAt)), 0);

export function getNextStep(
  plannerHistory: ReadonlyArray<{ savedAt?: string }>,
  reportHistory: ReadonlyArray<{ savedAt?: string }>,
  now: Date = new Date(),
): NextStep {
  const plan = latest(plannerHistory);
  const report = latest(reportHistory);
  if (plan === 0) return "planner";
  const ageHours = (now.getTime() - plan) / 3_600_000;
  if (ageHours > PLAN_FRESH_HOURS) return "planner";
  return plan > report ? "report" : "planner";
}
