import { useState, useEffect } from "react";
import { Building2, Calendar, Clock, X } from "lucide-react";
import { WARDS, SHIFTS } from "../utils/clinicalConstants";
import { calcRemainingAtHandover } from "../utils/reportFormatter";
import { loadCustomWards, saveCustomWard, deleteCustomWard } from "../utils/storage";
import type { ShiftHeader as ShiftHeaderType, ShiftType } from "../types";

interface ShiftHeaderProps {
  header: ShiftHeaderType;
  onChange: (header: ShiftHeaderType) => void;
}

export default function ShiftHeader({ header, onChange }: ShiftHeaderProps) {
  const remaining = calcRemainingAtHandover(header);
  const field = (key: keyof ShiftHeaderType, value: string) =>
    onChange({ ...header, [key]: value });

  const [customWards, setCustomWards] = useState<string[]>([]);
  const [customWardInput, setCustomWardInput] = useState("");
  const [showingCustomInput, setShowingCustomInput] = useState(false);

  useEffect(() => {
    setCustomWards(loadCustomWards());
  }, []);

  const knownWards = WARDS.filter(w => w !== "Other");
  const isCustomWard = Boolean(header.ward && !knownWards.includes(header.ward));
  const selectValue = isCustomWard ? "Other" : (header.ward || "");

  const handleWardSelectChange = (val: string) => {
    if (val === "Other") {
      setShowingCustomInput(true);
      setCustomWardInput("");
      field("ward", "");
    } else {
      setShowingCustomInput(false);
      setCustomWardInput("");
      field("ward", val);
    }
  };

  const commitCustomWard = () => {
    const trimmed = customWardInput.trim();
    if (!trimmed) return;
    field("ward", trimmed);
    saveCustomWard(trimmed);
    setCustomWards(loadCustomWards());
    setShowingCustomInput(false);
  };

  const handleCustomWardKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commitCustomWard();
    if (e.key === "Escape") {
      setShowingCustomInput(false);
      setCustomWardInput("");
      field("ward", "");
    }
  };

  const applyCustomWard = (ward: string) => {
    field("ward", ward);
    setShowingCustomInput(false);
    setCustomWardInput("");
  };

  const handleDeleteCustomWard = (ward: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCustomWard(ward);
    setCustomWards(loadCustomWards());
    if (header.ward === ward) field("ward", "");
  };

  interface StatInputProps { label: string; k: keyof ShiftHeaderType; hint: string; }
  const StatInput = ({ label, k, hint }: StatInputProps) => (
    <div>
      <label className="block text-xs text-slate-500 mb-1.5 font-medium">{label}</label>
      <input type="number" min="0" value={header[k] || ""} onChange={(e) => field(k, e.target.value)}
        placeholder="0" title={hint}
        className="input-field text-center text-base font-semibold" />
    </div>
  );

  return (
    <div className="space-y-5 fade-up">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Ward / Unit</label>

          {customWards.length > 0 && !showingCustomInput && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {customWards.map(w => (
                <button
                  key={w}
                  onClick={() => applyCustomWard(w)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs border transition-all ${
                    header.ward === w
                      ? "bg-teal-50 border-teal-300 text-teal-700"
                      : "bg-white border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-600"
                  }`}
                >
                  {w}
                  <span
                    onClick={(e) => handleDeleteCustomWard(w, e)}
                    className="text-slate-600 hover:text-red-400 transition-colors cursor-pointer"
                  >
                    <X size={10} />
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <Building2 size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <select
              value={showingCustomInput ? "Other" : selectValue}
              onChange={(e) => handleWardSelectChange(e.target.value)}
              className="select-field"
              style={{ paddingLeft: "36px" }}
            >
              <option value="">Select ward</option>
              {WARDS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>

          {(showingCustomInput || isCustomWard) && (
            <div className="mt-2">
              <input
                type="text"
                value={showingCustomInput ? customWardInput : header.ward}
                onChange={(e) => {
                  if (showingCustomInput) {
                    setCustomWardInput(e.target.value);
                  } else {
                    field("ward", e.target.value);
                  }
                }}
                onBlur={() => { if (showingCustomInput) commitCustomWard(); }}
                onKeyDown={handleCustomWardKeyDown}
                placeholder="Type ward name, press Enter to save"
                autoFocus={showingCustomInput}
                className="input-field border-teal-600/50"
              />
              <p className="text-xs text-slate-600 mt-1">Press Enter to save for future use</p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Shift</label>
          <div className="relative">
            <Clock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <select value={header.shift} onChange={(e) => field("shift", e.target.value as ShiftType)} className="select-field" style={{ paddingLeft: "36px" }}>
              <option value="">Select shift</option>
              {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">Date</label>
          <div className="relative">
            <Calendar size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <input type="date" value={header.date} onChange={(e) => field("date", e.target.value)}
              onClick={(e) => (e.target as HTMLInputElement).showPicker?.()}
              className="input-field cursor-pointer" style={{ paddingLeft: "36px" }} />
          </div>
          <p className="text-xs text-slate-600 mt-1">Appears as DD/MM/YY in report</p>
        </div>
      </div>

      <div className="card">
        <p className="section-label mb-4">Shift Patient Flow</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-8 gap-3 mb-4">
          <StatInput label="Taken Over" k="takenOver" hint="Patients at start of shift" />
          <StatInput label="Admissions" k="admissions" hint="New admissions during shift" />
          <StatInput label="Transfers In" k="transfersIn" hint="Transfers into ward" />
          <StatInput label="Transfers Out" k="transfersOut" hint="Transferred to other wards" />
          <StatInput label="Discharges" k="discharges" hint="Discharged patients" />
          <StatInput label="DAMA" k="dama" hint="Discharged Against Medical Advice" />
          <StatInput label="Deaths" k="deaths" hint="Deaths during shift" />
          <StatInput label="Referrals Out" k="referralsOut" hint="Referred to other facilities" />
        </div>
        <div className="flex items-center justify-between bg-teal-500/8 border border-teal-500/20 rounded-xl px-5 py-4">
          <span className="text-sm text-teal-700 font-medium">Patients at Handover</span>
          <span className="font-display text-3xl font-semibold text-teal-400">
            {remaining >= 0 ? remaining : <span className="text-red-400 text-sm font-sans">Check numbers</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
