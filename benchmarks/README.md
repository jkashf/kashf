# Kashf Speech & Translation Quality Gate v1

This directory is isolated from the browser production path. Nothing under `benchmarks/` is loaded by `index.html`, `app.js`, or an API route.

## Run

Use Node.js 18 or newer:

```text
node benchmarks/run.mjs
node benchmarks/quality-gate.test.mjs
node benchmarks/phase2.mjs dry-run
node benchmarks/phase2.mjs live-plan
node benchmarks/phase2.mjs summarize-reviews
node benchmarks/phase2.test.mjs
node benchmarks/style-contract.test.mjs
```

The runner makes no network or paid provider calls. It writes:

- `reports/current.json`: machine-readable scores, flags, pacing simulations and latency budget.
- `reports/blind-review.html`: neutral Variant A/B/C human-review sheet.
- `reports/phase2-dry-run.json`: real-audio readiness, adapter matrix, translation tracks, lifecycle analysis and offline pacing comparison.
- `reports/review-template.json`: machine-readable local review template.

## Real-audio workflow

1. Copy a consented `.mp3`, `.m4a`, `.wav`, or `.webm` file into `benchmarks/fixtures/audio/`. This directory is ignored by Git.
2. Replace one placeholder in `datasets/real-audio-core-v1.json` with its relative filename, duration, provenance/privacy fields, reviewer, verified transcript and optional language-switch segments.
3. Set `allowedForLocalBenchmark=true` only when permission is documented. Set `humanVerified=true` only after transcript review.
4. Run `node benchmarks/phase2.mjs dry-run`. The fixture becomes `ready`; missing or unverified fixtures remain `not_run`.
5. Run `node benchmarks/phase2.mjs live-plan` before any provider work. It prints fixture/configuration/request counts and performs zero calls.

Long files can use the deterministic `segmentPlan(durationSeconds, segmentSeconds)` helper. This does not change production chunking.

## STT matrix

- CURRENT_STT: `whisper-1`, `language=ar`, `verbose_json`, segment timestamps.
- WHISPER_AUTO: `whisper-1`, no language field, otherwise identical.
- GPT4O_MINI_TRANSCRIBE: `gpt-4o-mini-transcribe`, JSON plus optional token logprobs.
- GPT4O_TRANSCRIBE: `gpt-4o-transcribe`, JSON plus optional token logprobs.

Official API behavior differs: GPT-4o transcribe models support only JSON response format, so Whisper segment fields (`no_speech_prob`, `avg_logprob`, `compression_ratio`) are never fabricated or filtered for them. All adapters normalize into one internal result schema with nullable segments/language/metadata and usage-based cost fields. No price is hardcoded.

Live execution is deliberately not part of the default command. `live-plan` must be reviewed first; opt-in enforcement requires `--confirm-live`. Fase 2 dry-run performs no provider call.

## Lifecycle export

On localhost or Vercel Preview only, run this manually in the browser console after a physical session:

```text
KashfLifecycle.downloadMetrics()
```

It exports sanitized numeric/event metadata only. It excludes audio, transcript text, translations, API keys, session IDs and passage IDs. Analyze an export with the lifecycle analyzer or replace the synthetic dry-run input while keeping private exports outside version control.

## Reviews

Candidate order is reproducibly shuffled per fixture and seed. Copy `reports/review-template.json` into ignored `benchmarks/reviews/local/`, create one file per reviewer/fixture, and fill scores 1–10 plus preference and flags. Qur'an/hadith fixtures require at least two independent reviewers. `summarize-reviews` reports averages, score range and preference agreement.

## Dataset policy

- `synthetic` tests infrastructure, detectors and safety behavior only.
- `human_verified` requires a human-approved transcript/reference and documented fixture provenance/consent.
- Do not use generated Arabic/Darija plus a generated translation as accuracy ground truth.
- Keep development and evaluation fixtures separate. Do not copy evaluation sentences into prompts.
- Real audio belongs in an ignored/local fixture store until consent, anonymisation and licensing are documented.

The v1 technical dataset contains **zero human-verified accuracy fixtures**. It therefore makes no claim about actual Arabic, Darija, Qur'an or hadith translation accuracy.

## Adding a future audio/STT adapter

Adapters should accept `{ model, audioFixture, languageHint, prompt }` and return `{ transcript, segments, latencyMs }`. Store only safe aggregate metadata in reports. Supported future model labels may include `whisper-1`, `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe`; this is benchmark capability, not production configuration.

Provider calls must be opt-in, server/local only, never expose keys, and never dump environment variables. The default runner remains offline.

## Translation A/B

`configs/translation-configs.json` defines CURRENT and benchmark-only candidate prompts. Candidate C applies `contracts/kashf-translation-style-v1.md`; it is not used by production. Candidate outputs can be imported into a fixture or a separate local result file. The HTML report deliberately uses neutral variant labels. No candidate is promoted automatically.

Human reviewers score meaning, natural Dutch, religious integrity, completeness, first-read comprehension and overall preference. First-read comprehension asks whether the passage was immediately understood after one reading. Automatic lexical flags support review but do not replace it.

## Initial release-gate proposal

Hard, already deterministic:

- zero religious/safety hard failures;
- zero visible meta/refusal output;
- 100% sequence integrity;
- 100% rejection of verified silence/hallucination fixtures;
- no lost passages.

Provisional and human-reviewed until a representative dataset exists:

- mean meaning fidelity ≥ 8/10;
- mean Dutch naturalness ≥ 8/10;
- mean first-read comprehension ≥ 8.5/10, with serious cases below 7 requiring review;
- religious integrity ≥ 9/10 for every Qur'an/hadith case;
- target em-dash use is zero; every em dash triggers a readability warning and above 2 per 100 words is a presentation-failure candidate, not automatic semantic rejection.

WER/CER becomes reportable only for `human_verified` transcripts. Dialect spelling variation means it must be interpreted together with omissions, hallucinations and religious-term preservation.
