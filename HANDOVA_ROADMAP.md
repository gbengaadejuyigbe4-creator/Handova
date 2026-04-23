# HANDOVA — Product Roadmap & Vision Document
**Author:** Gbenga Adejuyigbe, RN, BNSc  
**Built with:** Claude (Anthropic)  
**Current Version:** v11.0  
**Document Date:** April 2026  

---

## WHO WE ARE

Handova is an AI-powered clinical workflow and nursing documentation system built by a practising Registered Nurse at Nigeria Police Medical Services, Akure. It is the only nursing documentation tool in the world built from actual bedside experience in an African clinical environment, with global deployment as its north star.

We are not a documentation tool. We are a clinical intelligence partner for nurses — at the bedside, during the shift, at handover.

---

## WHERE WE ARE NOW — v11.0

### Fully Built and Deployed:
- AI-powered nurses' note generation from voice, text, and EMR PDF
- Deepgram Nova-3-Medical voice transcription
- Medikal HMS PDF extraction — two-pass diagnosis rescue pipeline
- AI-generated shift assessment questions specific to each patient's clinical record
- Multi-layer note generation — PDF + Q&A + voice combined
- Shift Planner — time-structured, evidence-based care plans per patient
- Multi-patient shift planning with nurse-to-patient ratio intelligence
- Combined shift timeline across all patients
- Records page — shift reports and care plans saved, reviewable, deletable
- Settings — nurse profile, facility, shift period defaults
- SBAR and Standard format toggle
- Report history with full document viewer
- PWA — installable on any device
- i18n foundation — English, French, Arabic with RTL
- Premium UI — dark landing page, clinical document output, time-saved counter
- Security — rate limiting, server-side API keys, no patient data stored

### Current Stack:
- React 19 + TypeScript + Vite + Tailwind CSS
- Vercel Serverless Functions
- Groq llama-3.3-70b-versatile — note generation, EMR extraction, question generation, shift planning
- Deepgram Nova-3-Medical — voice transcription
- pdf-parse — server-side PDF extraction

---

## WHERE WE ARE GOING — The Intelligence Roadmap

### PHASE 1 — Clinical Intelligence Layer (v11.1 — v11.5)
*Target: 3 months*

#### 1. Predictive Clinical Flags
Read the patient's HMS record and generate proactive warnings at the start of every shift — specific to diagnosis, medications, vitals trend, and clinical history.

Not generic warnings. Specific reasoning:
- Sickle cell patient → acute chest syndrome risk, specific signs to watch
- Post-op Day 2 → DVT and surgical site infection window
- Eclampsia risk → magnesium toxicity monitoring, calcium gluconate readiness
- DKA on insulin infusion → hypokalaemia risk, arrhythmia watch
- Head injury → GCS deterioration window, secondary brain injury signs
- Sepsis criteria → SIRS flags, time-to-antibiotic urgency
- Blood transfusion → transfusion reaction monitoring protocol

Delivery: automatic card at top of patient form when EMR is applied. No nurse action required.

#### 2. Risk-Stratified Handover Brief
At end of shift, Handova reads all patients simultaneously and produces a ranked handover brief — not individual notes but a collective intelligence view of the ward.

Output:
- 🔴 IMMEDIATE — action required within 15 minutes of takeover
- 🟠 HIGH — action required within first hour
- 🟡 WATCH — monitoring priority, no immediate action
- 🟢 STABLE — routine care, no flags

Specific reasoning per patient. The oncoming nurse knows where to go first before they touch a single chart.

#### 3. Medication Safety Layer
Silent background monitoring. Surfaces only when needed:
- Missed or delayed doses based on prescription timing
- Frequency violations — drug given too soon
- Allergy cross-reference from HMS record
- High-risk medication double-check prompts (insulin, digoxin, anticoagulants, IV potassium, magnesium sulphate)
- Prescribed but not documented — quiet reminder

Delivery: non-intrusive notification card. Never an alarm. Always calm, specific, actionable.

#### 4. Continuity of Care Memory
When a nurse cares for a patient they have documented before, Handova generates a personalised returning brief:

- What has changed since your last shift
- Key clinical events in the intervening shifts
- Current priorities based on today's HMS record
- What the previous nurse flagged as watch items

Pulls from Records history. Zero extra work for the nurse.

---

### PHASE 2 — Global Expansion Engine (v12.0)
*Target: 6 months*

#### 5. Global Clinical Language Engine
Country and facility-specific documentation output:

- Nigeria → Nigerian nursing language, Medikal HMS format, Nigerian formulary
- United Kingdom → NMC standards, SBAR mandatory, BNF drug references, SystemOne/EMIS
- UAE/Dubai → DHA guidelines, JCI standards, bilingual Arabic/English option
- Philippines → PHIC standards, structured nursing care plan format
- Australia → AHPRA standards, ISBAR format, aged care variants
- Canada → CNO standards, provincial variations, bilingual Quebec option

Setting: nurse selects country and facility type in Settings. All outputs adapt automatically. Intelligence layer references country-appropriate clinical guidelines.

This is the feature that makes Handova a global company.

---

### PHASE 3 — Visual Clinical Intelligence (v12.5)
*Target: 9 months*

#### 6. Evidence-Based Reasoning Visible
Every intervention in the Shift Planner shows its clinical rationale:

- Guideline source (JNC 8, ADA 2024, WHO, NICE, DHA protocol)
- Target parameters specific to this patient
- Specific escalation threshold with reasoning
- Why this timing, why this frequency

Junior nurses learn. Senior nurses get confirmation. Hospital administrators get accreditation evidence.

#### 7. Gantt Chart Shift Timeline
Visual horizontal timeline for the full shift — colour-coded by patient and priority. The nurse sees the entire shift at a glance. Overdue items turn red in real time. Completed items check off with animation.

This is the screenshot feature. The one that gets shared. The one that makes people ask who built this.

#### 8. Shift Complexity Score
After report generation, a badge appears:

*"This shift: HIGH complexity — 8 patients, 3 clinical flags, 2 escalation events. Documentation complete."*

Low / Moderate / High / Critical. Based on patient acuity, number of flags, medications administered, and clinical events. 

Makes nurses feel seen. Makes administrators understand workload. Makes the case for adequate staffing.

---

### PHASE 4 — Platform & Revenue (v13.0)
*Target: 12 months*

#### Pricing Model
- **Free tier:** 3 reports per shift, basic note generation, no planner, no EMR upload
- **Pro — $9.99/month:** Unlimited reports, full planner, EMR upload, Q&A intelligence, records history, all clinical flags
- **Institutional — $2,000/month:** Up to 80 nurses, admin dashboard, usage analytics, ward-level reporting, custom facility language settings, dedicated support

#### Target Markets in Order:
1. Nigeria — NPMS and similar facilities, proof of concept, first paying users
2. United Kingdom — Large Nigerian and Filipino nurse diaspora, NHS-adjacent facilities
3. UAE/Dubai — DHA-licensed hospitals, international nurse workforce, premium pricing market
4. Philippines — Largest nurse-exporting country in the world, massive community
5. Canada/Australia — Strong immigrant nurse communities, high willingness to pay

#### The Acquisition Conversation (when ready):
Do not sell before:
- 500 daily active users
- $5,000 Monthly Recurring Revenue
- Presence in at least 2 countries
- One institutional client

At that point the conversation is not $10,000. It is $500,000 minimum. Potentially equity in a larger health tech company with Handova integrated as their nursing intelligence layer.

---

## THE COMPETITIVE MOAT

**What our competitors have:**
- Nuance DAX — Microsoft backing, $500M+ investment, physician focused
- Suki AI — $165M raised, physician focused, US only
- Abridge — Epic partnership, physician focused, US only
- Nabla — European, physician focused

**What none of them have:**
- A nurse who built it
- Nigerian clinical language
- Medikal HMS integration
- International nurse community understanding
- Shift handover intelligence
- Nurse-to-patient ratio awareness
- Predictive clinical flags for ward nursing scenarios
- The ability to work in Lagos, Dubai, London, and Manila with the same product

**The moat in one sentence:**
We are closer to the nurse than any competitor will ever be — because we are the nurse.

---

## THE NORTH STAR METRIC

**Daily Active Nurses.**

Not downloads. Not registrations. Not revenue.

Nurses who open Handova every shift because they cannot imagine documenting without it.

When that number is 1,000, everything else follows.

---

## THE FOUNDING STORY

Built on night shifts at Nigeria Police Medical Services, Akure.  
No coding background. No funding. No team.  
Just a nurse who saw the problem every day and refused to accept that nothing could be done about it.  
Built with Claude (Anthropic) as technical co-builder.  
From a single HTML file to a full-stack AI clinical platform in under 6 months.  

That story does not lose in any pitch room in the world.

---

*"We are not building a documentation tool.*  
*We are building the clinical intelligence that every nurse deserves*  
*but has never had access to."*

---

**Next build session:** Predictive Clinical Flags (Phase 1, Feature 1)  
**Immediate priority:** Deploy v11.0, use on morning shift, collect real feedback  
**Revenue target:** First paying user within 90 days  
**Global target:** Users in 3 countries within 6 months  

---
*Handova · Built by Gbenga Adejuyigbe, RN, BNSc · NPMS Akure · 2026*
