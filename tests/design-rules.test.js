import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Guards the design decisions so they do not quietly erode:
// no emoji or decorative styling in the UI code, readable colour contrast, fonts bundled for offline use.

const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
const tsx = walk("src").filter((f) => f.endsWith(".tsx"));
const read = (f) => readFileSync(f, "utf8");

describe("UI code", () => {
  // Pictographs render in full colour on phones and read as decoration. Use the icon set instead.
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B50}\u{2705}\u{274C}\u{2728}\u{270D}\u{2764}\u{2139}\u{27A1}\u{FE0F}]/u;

  it("has no emoji in any component", () => {
    const hits = tsx.filter((f) => EMOJI.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("has no all-caps or wide letter-spacing utilities", () => {
    const hits = tsx.filter((f) => /(?<![\w-])(uppercase|tracking-(?:wide|wider|widest))(?![\w-])/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("has no gradient backgrounds", () => {
    const hits = tsx.filter((f) => /bg-gradient|linear-gradient|radial-gradient/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("does not rely on an emoji for logic", () => {
    // the escalation banner is detected by its text, not by a pictograph
    expect(read("src/components/ShiftPlanner.tsx")).toContain('startsWith("ESCALATE NOW")');
  });
});

describe("fonts", () => {
  it("are bundled, so the app works offline and without Google", () => {
    expect(read("index.html")).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(read("src/main.tsx")).toContain("@fontsource-variable/atkinson-hyperlegible-next");
    expect(read("tailwind.config.js")).toContain("Atkinson Hyperlegible Next Variable");
  });
});

// ---- colour contrast, read from the CSS variables themselves --------------------
const css = read("src/index.css");
const block = (selector) => css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)));
const vars = (b) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const light = vars(block(":root {"));
const dark = { ...light, ...vars(block(".dark {")) };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ["light", light],
  ["dark", dark],
])("colour contrast (%s)", (_name, t) => {
  it.each([
    ["text-primary", "surface-1"],
    ["text-primary", "page-bg"],
    ["text-secondary", "surface-1"],
    ["text-muted", "surface-1"],
    ["text-muted", "page-bg"],
    ["teal-600", "surface-1"],
  ])("%s on %s is at least 4.5:1 (small text)", (fg, bg) => {
    const fgKey = _name === "dark" && fg === "teal-600" ? "teal-400" : fg;
    expect(ratio(t[fgKey], t[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each([["surface-1"], ["page-bg"]])("input edges are at least 3:1 against %s", (bg) => {
    expect(ratio(t["border-strong"], t[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe("primary button", () => {
  it("has readable text in light mode (white on scrub green)", () => {
    expect(ratio("#FFFFFF", light["teal-600"])).toBeGreaterThanOrEqual(4.5);
  });
  it("has readable text in dark mode (dark on light green)", () => {
    expect(ratio("#04201A", dark["teal-500"])).toBeGreaterThanOrEqual(4.5);
  });
});
