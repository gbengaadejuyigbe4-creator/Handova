# Measuring Handova's voice accuracy on real recordings

The automatic tests prove the cleaning rules and the recorder behave. They cannot say how well the
speech engine hears YOUR voice, your accent or your ward. Only real recordings can. This takes about
an hour, and it tells you which settings to use.

## 1. Record

Use invented dictation only. No real patient information, names or numbers from real patients.

Record 20 to 30 short dictations on your phone, the way you would dictate a handover.

- 10 in a quiet room, 10 on the ward with normal noise (monitors, talking, trolleys).
- Include some with figures and medicines, for example:
  - Vital signs stable. BP 120 over 80, pulse 88, temperature 36.8, SpO2 98 percent.
  - Gave paracetamol 1 g IV at 6 am for temperature 38.4. Doctor is aware.
  - Random blood sugar 18.2 mmol. Insulin 6 units subcutaneous given.
  - GCS 13, pupils equal and reactive to light.
  - Intake 1500 ml, urine output 400 ml over 8 hours.
  - Artemether lumefantrine started per doctor's order.
- Say each one the way you naturally would.

## 2. Write down what you said

For every recording, make a text file with the same name that holds exactly what you said:

    dictation01.m4a
    dictation01.txt     <- "Vital signs stable. BP 120 over 80, pulse 88 ..."

Put them all in one folder, for example `recordings`.

## 3. Run it (Windows cmd, in Desktop\Handova)

    set DEEPGRAM_API_KEY=your-key
    node tools/voice-eval.mjs recordings --label baseline
    node tools/voice-eval.mjs recordings --label british --language en-GB
    node tools/voice-eval.mjs recordings --label indian --language en-IN
    node tools/voice-eval.mjs recordings --label no-boost --no-keyterms

Deepgram has no Nigerian English setting. These runs show whether a different English setting hears
you better.

## 4. Read the result

Each run prints, for every recording, what you said, what was heard, and what was missing. The
summary has two scores:

- **Word error rate.** Lower is better.
- **Critical recall.** Of the numbers, units, medicine names and clinical terms you said, how many
  came through. This is the score that matters for patients. A wrong dose counts here.

Compare the runs. If one language setting is clearly better on critical recall, set it in Vercel:

    DEEPGRAM_LANGUAGE = en-GB

(allowed: en, en-US, en-AU, en-GB, en-IN, en-NZ). Do not change a setting on a small
difference. Use the same recordings for every run.

## What this does not measure

How the microphone and the browser's noise handling affect the sound before it is sent. To test that,
record the same dictation in the Handova app itself under different conditions and compare what the
nurse sees.
