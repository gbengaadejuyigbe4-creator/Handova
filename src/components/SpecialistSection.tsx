/**
 * SpecialistSection.tsx
 *
 * "Specialist perspectives" for one uploaded patient. Nothing runs until the user clicks.
 * It asks /api/specialist, which builds a numbered snapshot of the record, asks the AI for
 * suggestions, and checks them. The cards are read-only: without sign-in there is no one
 * to record a decision against, so no Accept or Reject buttons are shown here.
 *
 * Every card carries the disclaimer. These are suggestions, never orders.
 */

import { useState } from "react";
import { Loader2, Stethoscope } from "lucide-react";
import { PerspectiveCard } from "./ClinicianDemo";
import type { DemoPerspective, FactRef } from "../demo/clinicianDemoData";

export interface SpecialistResponse {
  perspectives: DemoPerspective[];
  notice: string;
  meta: {
    lenses: { key: string; label: string; reason: string }[];
    removed: { invalidCitations: number; orderLikeItems: number; invalidGaps: number; droppedPerspectives: number };
  };
  snapshot: { facts: FactRef[] };
}

export interface SpecialistRequest {
  extracted: unknown;
  filteredText: string;
  summary?: string;
  unreviewedResults?: string[];
}

/** Calls the server and turns every failure into a readable message. */
export async function requestSpecialist(payload: SpecialistRequest): Promise<SpecialistResponse> {
  const response = await fetch("/api/specialist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: any;
  try {
    data = await response.json();
  } catch {
    if (response.status === 408 || response.status === 504) {
      throw new Error("The server took too long to respond. Please try again.");
    }
    throw new Error(`The server had a problem (error ${response.status}). Please try again.`);
  }
  if (!response.ok) throw new Error(data?.error || "Specialist perspectives could not be generated.");
  return data as SpecialistResponse;
}

export function SpecialistResults({ data }: { data: SpecialistResponse }) {
  const removed = data.meta?.removed;
  const removedCount = removed ? removed.orderLikeItems + removed.invalidCitations + removed.invalidGaps : 0;

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
        ⚠ {data.notice}
      </p>

      {data.perspectives.length === 0 ? (
        <p className="text-sm text-slate-700 rounded-lg border border-slate-200 bg-white px-3 py-3">
          No suggestions passed the safety checks for this record. That says nothing about the patient.
        </p>
      ) : (
        data.perspectives.map((p) => (
          <PerspectiveCard key={p.id} p={p} facts={data.snapshot?.facts || []} role="viewer" />
        ))
      )}

      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-700">How these were chosen</summary>
        <div className="px-3 pb-3 space-y-1 text-xs text-slate-700">
          {(data.meta?.lenses || []).map((l) => (
            <p key={l.key}><b>{l.label}:</b> {l.reason}</p>
          ))}
          {removedCount > 0 && (
            <p className="text-slate-500">
              Safety checks removed {removedCount} item{removedCount === 1 ? "" : "s"} (worded as an order, unsupported by the record, or incomplete).
            </p>
          )}
        </div>
      </details>
    </div>
  );
}

export default function SpecialistSection({ extracted }: { extracted: any }) {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [data, setData] = useState<SpecialistResponse | null>(null);
  const [error, setError] = useState("");

  const record = extracted?.extracted;
  if (!record) return null;

  const run = async () => {
    setStatus("loading");
    setError("");
    try {
      const result = await requestSpecialist({
        extracted: record,
        filteredText: extracted.emrClinicalText || extracted.filteredText || "",
        summary: record.summary || "",
        unreviewedResults: Array.isArray(record.unreviewedResults) ? record.unreviewedResults : [],
      });
      setData(result);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Specialist perspectives could not be generated.");
      setStatus("error");
    }
  };

  return (
    <div className="space-y-2">
      {status !== "done" && (
        <button
          onClick={run}
          disabled={status === "loading"}
          className="w-full flex items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-3 py-2.5 text-xs font-bold text-indigo-800 disabled:opacity-60"
        >
          {status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Stethoscope size={13} />}
          {status === "loading" ? "Reading the record..." : "Specialist perspectives (AI suggestions)"}
        </button>
      )}
      {status === "idle" && (
        <p className="text-[11px] text-slate-500 px-1">
          Suggestions for a doctor to consider, including information that may be missing from the record. Not orders.
        </p>
      )}
      {status === "error" && (
        <p className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
      )}
      {status === "done" && data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-indigo-800 flex items-center gap-1.5"><Stethoscope size={13} /> Specialist perspectives</span>
            <button onClick={() => { setStatus("idle"); setData(null); }} className="text-[11px] text-indigo-700 underline">Close</button>
          </div>
          <SpecialistResults data={data} />
        </div>
      )}
    </div>
  );
}
