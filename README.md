# Handova v8.1

AI-powered nursing shift handover tool built for Nigerian clinical settings.

Nurses speak or type shift events — Handova generates a structured, professional nurse's note using AI.

## Features

- 🎤 Voice input with silence detection (Groq Whisper)
- 🤖 AI nurse's note generation (Groq LLaMA)
- 📋 Patient form with clinical fields
- 📜 Report history
- 📱 Mobile-friendly, installable PWA

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS
- Groq API (Whisper + LLaMA)
- Vercel (hosting + serverless functions)

## Project Structure

```
handova/
├── api/
│   ├── generate.js       # Vercel function — AI note generation
│   └── transcribe.js     # Vercel function — voice transcription
├── public/               # Static assets & PWA manifest
├── src/
│   ├── components/       # React UI components
│   ├── hooks/            # useVoiceInput, useShiftReport, usePatientForm
│   ├── utils/            # API calls, formatters, storage
│   └── types/            # TypeScript types
└── vercel.json           # Vercel deployment config
```

## Environment Variables (Vercel)

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Your Groq API key (starts with `gsk_`) |
| `ALLOWED_ORIGIN` | Optional: restrict CORS to your domain |

## Author

Gbenga Adejuyigbe, RN, BNSc © 2026
