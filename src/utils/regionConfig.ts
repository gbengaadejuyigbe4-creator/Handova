/**
 * regionConfig.ts — Region-aware clinical configuration for Handova
 *
 * Each region defines:
 *   - Report format preferences (SBAR, ISBAR, Standard)
 *   - Clinical terminology map
 *   - Compliance framework name
 *   - AI prompt language instructions
 *   - Default facility placeholder
 *
 * Author: Gbenga Adejuyigbe, RN, BNSc
 */

export type Region =
  | "ng"   // Nigeria
  | "gb"   // United Kingdom
  | "us"   // United States
  | "au"   // Australia
  | "ae"   // UAE / Gulf States
  | "in"   // India
  | "other";

export interface RegionConfig {
  code: Region;
  label: string;
  flag: string;
  formats: ("standard" | "sbar" | "isbar" | "soap")[];
  defaultFormat: "standard" | "sbar" | "isbar" | "soap";
  compliance: string;
  facilityPlaceholder: string;
  clinicalLanguagePrompt: string;
  /** Key terminology substitutions for this region */
  terminology: {
    emrName: string;         // "Medikal HMS" / "EPR" / "EHR" / "EMR"
    emergencyRoom: string;   // "A&E" / "Emergency" / "ER" / "ED"
    theatre: string;         // "Theatre" / "OR" / "OT"
    wardRound: string;       // "Ward round" / "Rounds" / "Consultant round"
    dripSet: string;         // "Giving set" / "IV set" / "Drip set"
  };
}

export const REGIONS: RegionConfig[] = [
  {
    code: "ng",
    label: "Nigeria",
    flag: "🇳🇬",
    formats: ["standard", "sbar", "soap"],
    defaultFormat: "standard",
    compliance: "Nigerian Nursing & Midwifery Council Standards",
    facilityPlaceholder: "e.g. Nigeria Police Medical Services, Akure",
    clinicalLanguagePrompt: `Write in Nigerian hospital clinical nursing language. Use these phrases naturally:
"served and documented" | "IV access in situ" | "nil complaint on shift" | "nil complaint throughout the shift"
"allay anxiety" | "ensured comfort" | "met lying on the bed" | "vital signs were checked and documented"
"responded well to treatment" | "at the time of reporting" | "at the time of handover"
"haemodynamically stable" | "within acceptable limits" | "in a fair state of health"`,
    terminology: {
      emrName: "HMS",
      emergencyRoom: "Emergency",
      theatre: "Theatre",
      wardRound: "Ward round",
      dripSet: "Drip set",
    },
  },
  {
    code: "gb",
    label: "United Kingdom",
    flag: "🇬🇧",
    formats: ["sbar", "standard", "soap"],
    defaultFormat: "sbar",
    compliance: "NMC Code & NHS Trust Standards",
    facilityPlaceholder: "e.g. Royal London Hospital, Barts Health NHS Trust",
    clinicalLanguagePrompt: `Write in UK NHS clinical nursing language following NMC documentation standards. Use these phrases naturally:
"handed over" | "observations recorded" | "NEWS score calculated" | "escalated to registrar"
"nil new concerns" | "cannula in situ" | "patient reviewed by SHO/SpR/Consultant"
"care plan in place" | "IV fluids prescribed and running" | "tolerating oral intake"
"stable and comfortable" | "observations within normal limits" | "at the time of handover"
Use British English spelling (e.g. haemodynamic, colour, behaviour, anaesthetic).`,
    terminology: {
      emrName: "EPR",
      emergencyRoom: "A&E",
      theatre: "Theatre",
      wardRound: "Consultant round",
      dripSet: "Giving set",
    },
  },
  {
    code: "us",
    label: "United States",
    flag: "🇺🇸",
    formats: ["sbar", "standard", "soap"],
    defaultFormat: "sbar",
    compliance: "Joint Commission NPSG & HIPAA Standards",
    facilityPlaceholder: "e.g. Johns Hopkins Hospital, Baltimore",
    clinicalLanguagePrompt: `Write in standard US clinical nursing documentation language following Joint Commission and HIPAA guidelines. Use these phrases naturally:
"patient assessed" | "vital signs obtained and within normal limits" | "IV site clean, dry, intact"
"physician notified" | "orders received and implemented" | "pain assessed using numeric scale"
"patient tolerated well" | "no acute distress" | "call light within reach"
"care plan updated" | "shift assessment completed" | "report given to oncoming RN"
Use American English spelling (e.g. hemodynamic, color, behavior, anesthetic). Use HIPAA-compliant language — share only minimum necessary PHI.`,
    terminology: {
      emrName: "EHR",
      emergencyRoom: "ED",
      theatre: "OR",
      wardRound: "Rounds",
      dripSet: "IV set",
    },
  },
  {
    code: "au",
    label: "Australia",
    flag: "🇦🇺",
    formats: ["isbar", "sbar", "standard", "soap"],
    defaultFormat: "isbar",
    compliance: "NSQHS Standards — Communicating for Safety",
    facilityPlaceholder: "e.g. Royal Melbourne Hospital, Melbourne Health",
    clinicalLanguagePrompt: `Write in Australian clinical nursing documentation language following NSQHS Communicating for Safety standards. Use these phrases naturally:
"patient assessed" | "observations attended and documented" | "MET call criteria not met"
"medical officer notified" | "care plan reviewed" | "fluid balance maintained"
"patient comfortable and settled" | "no deterioration noted" | "handover to incoming shift"
"within acceptable parameters" | "tollerated diet and fluids" | "IV access patent"
Use Australian English spelling (e.g. haemodynamic, colour, behaviour, anaesthetic).`,
    terminology: {
      emrName: "EMR",
      emergencyRoom: "ED",
      theatre: "Theatre",
      wardRound: "Ward round",
      dripSet: "Giving set",
    },
  },
  {
    code: "ae",
    label: "UAE / Gulf States",
    flag: "🇦🇪",
    formats: ["sbar", "standard", "soap"],
    defaultFormat: "sbar",
    compliance: "MOH & JCI Accreditation Standards",
    facilityPlaceholder: "e.g. Cleveland Clinic Abu Dhabi",
    clinicalLanguagePrompt: `Write in clinical nursing language following UAE Ministry of Health and JCI accreditation documentation standards. Use these phrases naturally:
"patient assessed" | "vital signs monitored and documented" | "physician informed"
"medications administered as prescribed" | "IV site assessed" | "pain management implemented"
"patient stable and comfortable" | "no new complaints" | "care rendered as per plan"
"observations within normal range" | "at the time of handover" | "endorsed to oncoming nurse"
Write in English. Use British English spelling conventions.`,
    terminology: {
      emrName: "EMR",
      emergencyRoom: "Emergency",
      theatre: "OT",
      wardRound: "Consultant round",
      dripSet: "IV set",
    },
  },
  {
    code: "in",
    label: "India",
    flag: "🇮🇳",
    formats: ["standard", "sbar", "soap"],
    defaultFormat: "standard",
    compliance: "NABH Documentation Standards",
    facilityPlaceholder: "e.g. AIIMS New Delhi",
    clinicalLanguagePrompt: `Write in Indian clinical nursing documentation language following INC and NABH standards. Use these phrases naturally:
"patient attended" | "vitals monitored and charted" | "doctor informed" | "IV in situ"
"medications administered as per physician order" | "patient comfortable"
"nil fresh complaints" | "care rendered" | "general condition stable"
"at the end of duty" | "handed over to night staff" | "all nursing care given"
Use Indian English conventions.`,
    terminology: {
      emrName: "HMS",
      emergencyRoom: "Emergency",
      theatre: "OT",
      wardRound: "Ward round",
      dripSet: "IV set",
    },
  },
  {
    code: "other",
    label: "Other",
    flag: "🌍",
    formats: ["sbar", "standard", "isbar", "soap"],
    defaultFormat: "sbar",
    compliance: "WHO Patient Safety Standards",
    facilityPlaceholder: "e.g. Your Hospital Name",
    clinicalLanguagePrompt: `Write in clear, professional clinical nursing documentation language using internationally recognised terminology. Use these phrases naturally:
"patient assessed" | "vital signs monitored and documented" | "IV access in situ"
"prescribed medications administered" | "physician notified" | "care plan implemented"
"patient stable and comfortable" | "no new complaints" | "at the time of handover"
Use SBAR-compatible language and internationally understood clinical terms.`,
    terminology: {
      emrName: "EMR",
      emergencyRoom: "Emergency Department",
      theatre: "Operating Room",
      wardRound: "Ward round",
      dripSet: "IV set",
    },
  },
];

/** Helper: get config for a region code */
export function getRegionConfig(region: Region): RegionConfig {
  return REGIONS.find(r => r.code === region) || REGIONS[0];
}
