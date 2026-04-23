/**
 * SettingsPanel.tsx — Handova v10.5
 * Fixed: Settings panel now renders correctly at all app states
 * Added: Shift period (start/end time) for Shift Planner
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

import { useState, useEffect } from "react";
import { X, Check, Globe, User, Building2, Stethoscope, Clock, MapPin } from "lucide-react";
import { loadSettings, saveSettings, AppSettings } from "../utils/settings";
import { LANGUAGES, Language, t } from "../utils/i18n";
import { WARDS, SHIFTS } from "../utils/clinicalConstants";
import { REGIONS, getRegionConfig } from "../utils/regionConfig";

interface SettingsPanelProps {
  onClose: () => void;
  onSettingsChange: (settings: AppSettings) => void;
  lang: Language;
}

export default function SettingsPanel({ onClose, onSettingsChange, lang }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    saveSettings(settings);
    onSettingsChange(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const inp = (key: keyof AppSettings, placeholder: string, type = "text") => (
    <input
      type={type}
      value={(settings[key] as string) || ""}
      onChange={e => set(key, e.target.value as never)}
      placeholder={placeholder}
      className="input-field"
    />
  );

  return (
    <div className="settings-modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* Centered panel */}
      <div className="settings-modal-panel">

        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{t(lang, "settingsTitle")}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t(lang, "settingsDesc")}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 px-6 py-6 space-y-8">

          {/* Language */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Globe size={15} className="text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{t(lang, "language")}</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {LANGUAGES.map(l => (
                <button
                  key={l.code}
                  onClick={() => set("language", l.code)}
                  className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all duration-200 text-center ${
                    settings.language === l.code
                      ? "bg-teal-500 text-white border-teal-500 shadow-sm"
                      : "border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700"
                  }`}
                >
                  <span className="block">{l.nativeLabel}</span>
                  <span className="block text-[10px] opacity-70 mt-0.5">{l.label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Region */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <MapPin size={15} className="text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Region</h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">
              Sets your report format, clinical language, and compliance framework automatically.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {REGIONS.map(r => (
                <button
                  key={r.code}
                  onClick={() => {
                    set("region", r.code);
                    const regionCfg = getRegionConfig(r.code);
                    set("defaultFormat", regionCfg.defaultFormat as AppSettings["defaultFormat"]);
                  }}
                  className={`flex items-center gap-2.5 py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all duration-200 text-left ${
                    settings.region === r.code
                      ? "bg-teal-500 text-white border-teal-500 shadow-sm"
                      : "border-slate-200 text-slate-600 hover:border-teal-300 hover:text-teal-700"
                  }`}
                >
                  <span className="text-base">{r.flag}</span>
                  <div>
                    <span className="block">{r.label}</span>
                    <span className={`block text-[9px] mt-0.5 ${
                      settings.region === r.code ? "text-teal-100" : "text-slate-400"
                    }`}>{r.compliance.split(" ").slice(0, 3).join(" ")}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Profile */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <User size={15} className="text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{t(lang, "profile")}</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">{t(lang, "nurseName")}</label>
                {inp("nurseName", "e.g. Gbenga Adejuyigbe")}
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">{t(lang, "nurseCredentials")}</label>
                {inp("nurseCredentials", "e.g. RN, BNSc")}
              </div>
            </div>
          </section>

          {/* Facility */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Building2 size={15} className="text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{t(lang, "facilityName")}</h3>
            </div>
            {inp("facilityName", t(lang, "facilityNamePlaceholder"))}
          </section>

          {/* Shift Period */}
          <section>
            <div className="flex items-center gap-2 mb-1">
              <Clock size={15} className="text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Shift Period</h3>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">
              Used by the Shift Planner to schedule time-based nursing interventions. You can also set this per-planner session.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">Shift Start</label>
                <input
                  type="time"
                  value={settings.shiftStartTime || ""}
                  onChange={e => set("shiftStartTime", e.target.value)}
                  className="input-field cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">Shift End</label>
                <input
                  type="time"
                  value={settings.shiftEndTime || ""}
                  onChange={e => set("shiftEndTime", e.target.value)}
                  className="input-field cursor-pointer"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              e.g. Morning: 08:00 – 20:00 · Night: 20:00 – 08:00
            </p>
          </section>

          {/* Defaults */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Stethoscope size={15} className="text-teal-600" />
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Defaults</h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">{t(lang, "defaultWard")}</label>
                <select value={settings.defaultWard} onChange={e => set("defaultWard", e.target.value)} className="select-field">
                  <option value="">No default</option>
                  {WARDS.filter(w => w !== "Other").map(w => <option key={w}>{w}</option>)}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">{t(lang, "defaultWardHint")}</p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">{t(lang, "defaultShift")}</label>
                <select value={settings.defaultShift} onChange={e => set("defaultShift", e.target.value)} className="select-field">
                  <option value="">No default</option>
                  {SHIFTS.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1.5 uppercase tracking-widest">{t(lang, "defaultFormat")}</label>
                <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-1">
                  {(getRegionConfig(settings.region || "ng").formats).map(fmt => (
                    <button
                      key={fmt}
                      onClick={() => set("defaultFormat", fmt)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                        settings.defaultFormat === fmt
                          ? "bg-white text-teal-700 shadow-sm"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      {fmt === "standard" ? t(lang, "standardFormat") : fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4">
          <button
            onClick={handleSave}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all duration-300 ${
              saved ? "bg-teal-700 text-white" : "btn-primary"
            }`}
          >
            {saved
              ? <><Check size={16} strokeWidth={3} /> {t(lang, "settingsSaved")}</>
              : t(lang, "saveSettings")
            }
          </button>
        </div>
      </div>
    </div>
  );
}
