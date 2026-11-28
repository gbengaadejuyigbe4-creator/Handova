#!/usr/bin/env node
/**
 * tools/voice-eval.mjs
 *
 * Measures how well Handova's speech-to-text handles YOUR recordings: your voice, your accent,
 * your ward's noise. Nothing here changes the app. See tools/VOICE_EVAL.md for how to record.
 *
 *   set DEEPGRAM_API_KEY=your-key            (Windows cmd)
 *   node tools/voice-eval.mjs recordings --label baseline
 *   node tools/voice-eval.mjs recordings --label british --language en-GB
 *   node tools/voice-eval.mjs recordings --label no-boost --no-keyterms
 *
 * In the folder, each recording needs a text file with the same name holding exactly what was said:
 *   shift1.m4a  +  shift1.txt
 *
 * Each run writes voice-eval-<label>.json and prints a summary you can compare between runs.
 * Recordings are sent to Deepgram, so use invented dictation only. No real patient information.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ALLOWED_LANGUAGES, KEYTERMS, buildListenUrl, parseDeepgram, processTranscript } from "../api/_speech.js";
import { criticalRecall, summarize, wer } from "./voice-metrics.js";

const AUDIO = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".webm": "audio/webm", ".ogg": "audio/ogg", ".flac": "audio/flac" };

export async function evaluateFolder(dir, { language = "en", keyterms = KEYTERMS, apiKey, fetchFn = fetch } = {}) {
  const files = (await readdir(dir)).filter((f) => AUDIO[path.extname(f).toLowerCase()]).sort();
  const results = [];
  for (const file of files) {
    const base = path.basename(file, path.extname(file));
    let reference;
    try {
      reference = (await readFile(path.join(dir, `${base}.txt`), "utf8")).trim();
    } catch {
      console.warn(`Skipped ${file}: no ${base}.txt beside it.`);
      continue;
    }
    const audio = await readFile(path.join(dir, file));
    const res = await fetchFn(buildListenUrl({ language, keyterms }), {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": AUDIO[path.extname(file).toLowerCase()] },
      body: audio,
    });
    if (!res.ok) throw new Error(`${file}: Deepgram answered ${res.status}`);
    const { transcript, words } = parseDeepgram(await res.json());
    const cleaned = processTranscript({ transcript, words });
    results.push({
      file, reference, heard: transcript, cleaned: cleaned.text,
      notes: cleaned.notes.map((n) => ({ kind: n.kind, message: n.message })),
      rawWer: wer(reference, transcript),
      wer: wer(reference, cleaned.text),
      critical: criticalRecall(reference, cleaned.text),
    });
  }
  return { language, keyterms: keyterms.length, results, summary: summarize(results) };
}

function printReport(label, out) {
  console.log(`\n=== ${label}: language ${out.language}, ${out.keyterms} key terms, ${out.summary.files} recordings ===`);
  for (const r of out.results) {
    const missing = Object.entries(r.critical).flatMap(([k, v]) => v.missing.map((m) => `${k}:${m}`));
    console.log(`\n${r.file}  WER ${(r.wer.rate * 100).toFixed(0)}%${missing.length ? "   MISSING " + missing.join(", ") : ""}`);
    console.log(`  said : ${r.reference}`);
    console.log(`  heard: ${r.heard}`);
    if (r.cleaned !== r.heard) console.log(`  clean: ${r.cleaned}`);
    for (const n of r.notes) console.log(`  note : [${n.kind}] ${n.message}`);
  }
  const s = out.summary;
  console.log(`\nSUMMARY  word error rate ${s.wordErrorRate}% (${s.wordErrorRateBeforeCleaning}% before cleaning)`);
  for (const [k, v] of Object.entries(s.criticalRecall)) console.log(`  ${k.padEnd(10)} ${v.found}/${v.expected}${v.percent == null ? "" : `  (${v.percent}%)`}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("voice-eval.mjs")) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--label" && args[args.indexOf(a) - 1] !== "--language");
  const label = flag("--label") || "run";
  const language = flag("--language") || "en";
  if (!dir) { console.error("Usage: node tools/voice-eval.mjs <folder> [--label name] [--language en-GB] [--no-keyterms]"); process.exit(1); }
  if (!ALLOWED_LANGUAGES.includes(language)) { console.error(`Language must be one of: ${ALLOWED_LANGUAGES.join(", ")}`); process.exit(1); }
  if (!process.env.DEEPGRAM_API_KEY) { console.error("Set DEEPGRAM_API_KEY first."); process.exit(1); }
  const out = await evaluateFolder(dir, { language, keyterms: args.includes("--no-keyterms") ? [] : KEYTERMS, apiKey: process.env.DEEPGRAM_API_KEY });
  printReport(label, out);
  await writeFile(`voice-eval-${label}.json`, JSON.stringify(out, null, 2));
  console.log(`\nSaved voice-eval-${label}.json`);
}
