import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseRoute, routeToHash, APP_ROUTES } from "../src/utils/route.ts";
import { getNextStep, PLAN_FRESH_HOURS } from "../src/utils/nextStep.ts";
import AppNav, { NAV_ITEMS } from "../src/components/AppNav.tsx";
import HomeScreen from "../src/components/HomeScreen.tsx";
import ShiftPlanner from "../src/components/ShiftPlanner.tsx";
import LandingPage from "../src/components/LandingPage.tsx";

const read = (f) => readFileSync(f, "utf8");
const noop = () => {};

// A browser is not available in these tests, so the pieces that touch the window are stubbed.
globalThis.window ??= {
  matchMedia: () => ({ matches: false }),
  addEventListener: noop,
  removeEventListener: noop,
};
globalThis.navigator ??= { userAgent: "test" };
globalThis.localStorage ??= { getItem: () => null, setItem: noop, removeItem: noop };

describe("route parsing", () => {
  it.each(["home", "planner", "report", "records"])("reads #/%s", (name) => {
    expect(parseRoute(`#/${name}`)).toBe(name);
  });

  it("round-trips every route", () => {
    for (const r of APP_ROUTES) expect(parseRoute(routeToHash(r))).toBe(r);
  });

  it("accepts a trailing slash", () => {
    expect(parseRoute("#/planner/")).toBe("planner");
  });

  it.each(["", "#", "#top", "#how-it-works", "#clinician-demo", "#/", "#/unknown", "#/planner?x=1", "#planner", "#/Planner"])(
    "treats %j as the landing page",
    (hash) => {
      expect(parseRoute(hash)).toBeNull();
    },
  );
});

describe("next step on Home", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  const at = (iso) => ({ savedAt: iso });

  it("suggests the planner when nothing is saved", () => {
    expect(getNextStep([], [], now)).toBe("planner");
  });

  it("suggests the report after a recent plan with no report since", () => {
    expect(getNextStep([at("2026-11-25T07:30:00Z")], [], now)).toBe("report");
  });

  it("suggests the planner again once the report is newer than the plan", () => {
    expect(getNextStep([at("2026-11-25T07:30:00Z")], [at("2026-11-25T09:30:00Z")], now)).toBe("planner");
  });

  it("works for a night shift that crosses midnight", () => {
    // plan 19:30, report 07:30 next morning: the report is newer, so a new shift starts with the planner
    const morning = new Date("2026-11-26T07:45:00Z");
    expect(getNextStep([at("2026-11-25T19:30:00Z")], [at("2026-11-26T07:30:00Z")], morning)).toBe("planner");
    // and at 06:00 the plan is 10.5 hours old with no report: the nurse is ending the shift
    expect(getNextStep([at("2026-11-25T19:30:00Z")], [], new Date("2026-11-26T06:00:00Z"))).toBe("report");
  });

  it("ignores a stale plan that never got a report", () => {
    const old = new Date(now.getTime() - (PLAN_FRESH_HOURS + 1) * 3_600_000).toISOString();
    expect(getNextStep([at(old)], [], now)).toBe("planner");
  });

  it("uses the newest entry, whatever the order of the history", () => {
    const plans = [at("2026-11-24T08:00:00Z"), at("2026-11-25T08:00:00Z")];
    expect(getNextStep(plans, [at("2026-11-24T20:00:00Z")], now)).toBe("report");
  });

  it("does not break on a missing or invalid date", () => {
    expect(getNextStep([{}, at("not a date")], [{}], now)).toBe("planner");
  });
});

describe("labelled navigation", () => {
  const render = (placement, current = "home") =>
    renderToStaticMarkup(createElement(AppNav, { current, onNavigate: noop, placement }));

  it("has the four screens in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Home", "Planner", "Report", "Records"]);
  });

  it.each(["top", "bottom"])("shows every label in the %s bar, not only the current one", (placement) => {
    const html = render(placement, "records");
    for (const { label } of NAV_ITEMS) expect(html).toContain(`<span>${label}</span>`);
    // no label is hidden on small screens
    expect(html).not.toMatch(/hidden sm:inline/);
  });

  it("marks only the current screen", () => {
    const html = render("bottom", "planner");
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("makes the phone bar touch-friendly and phone-only", () => {
    const html = render("bottom");
    expect(html).toContain("min-h-[56px]");
    expect(html).toContain("sm:hidden");
    expect(html).toContain("safe-area-inset-bottom");
  });

  it("puts the top bar on larger screens only", () => {
    expect(render("top")).toContain("hidden sm:flex");
  });
});

describe("Home", () => {
  const home = (nextStep) => renderToStaticMarkup(createElement(HomeScreen, { onNavigate: noop, nextStep }));

  it("offers the planner, the report and Records by name", () => {
    const html = home("planner");
    expect(html).toContain("Shift planner");
    expect(html).toContain("Handover report");
    expect(html).toContain("Start of shift");
    expect(html).toContain("End of shift");
    expect(html).toContain("Open Records");
  });

  it("marks exactly one card as suggested", () => {
    expect(home("planner").match(/Suggested next/g)).toHaveLength(1);
    expect(home("report").match(/Suggested next/g)).toHaveLength(1);
  });

  it("puts the suggestion on the right card", () => {
    const planner = home("planner");
    expect(planner.indexOf("Suggested next")).toBeLessThan(planner.indexOf("End of shift"));
    const report = home("report");
    expect(report.indexOf("Suggested next")).toBeGreaterThan(report.indexOf("End of shift"));
  });
});

describe("landing page", () => {
  const html = renderToStaticMarkup(createElement(LandingPage, { onOpen: noop }));

  it("offers both tools as buttons", () => {
    expect(html).toContain("Start of shift: Shift planner");
    expect(html).toContain("End of shift: Handover report");
  });

  it("shows a sample care plan on an invented patient", () => {
    expect(html).toContain("Example care plan");
    expect(html).toContain("Example, invented patient");
  });

  it("keeps the AI-draft label on the samples", () => {
    expect(html.match(/An AI draft for the nurse to check and edit/g)).toHaveLength(2);
  });
});

describe("Shift planner empty state", () => {
  const html = renderToStaticMarkup(createElement(ShiftPlanner, { settings: {} }));

  it("is called Shift planner and says when to use it", () => {
    expect(html).toContain("Shift planner");
    expect(html).toContain("Start of shift");
  });

  it("explains itself in three steps before any plan exists", () => {
    expect(html).toContain("How the shift planner works");
    expect(html).toContain("Set the shift.");
    expect(html).toContain("Add each patient.");
    expect(html).toContain("Generate the care plan.");
  });
});

describe("wiring", () => {
  const app = read("src/App.tsx");
  const onboarding = read("src/components/Onboarding.tsx");

  it("opens on Home, not Report", () => {
    expect(app).toContain('route ?? "home"');
  });

  it("no longer keeps the screen in component state", () => {
    expect(app).not.toMatch(/setAppPage|setShowLanding/);
  });

  // These are source checks, not a browser test: there is no DOM in this suite. They guard the
  // refresh-loses-your-report bug: the draft must be read once at start, restored, and
  // restored BEFORE the effect that auto-saves the (still empty) state over it.
  it("restores a saved draft when the app is opened or refreshed on a screen", () => {
    expect(app).toContain("useState(() => (route !== null ? loadDraft() : null))");
    expect(app).toContain("if (initialDraft) loadFromDraft(initialDraft.header, initialDraft.patients)");
    expect(app.indexOf("if (initialDraft) loadFromDraft")).toBeLessThan(app.indexOf("saveDraft(header, patients)"));
  });

  it("keeps the tour anchors and the demo route", () => {
    for (const id of ["step-0", "step-1", "step-2"]) {
      expect(app).toContain("id={`step-${i}`}");
      expect(onboarding).toContain(`"${id}"`);
    }
    expect(read("src/main.tsx")).toContain("#clinician-demo");
  });

  it("mentions the planner in the tour", () => {
    expect(onboarding).toContain("Shift planner");
  });
});
