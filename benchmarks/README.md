# Kashf Speech & Translation Quality Gate v1

This directory is isolated from the browser production path. Nothing under `benchmarks/` is loaded by `index.html`, `app.js`, or an API route.

## Run

Use Node.js 18 or newer:

```text
node benchmarks/run.mjs
node benchmarks/quality-gate.test.mjs
```

The runner makes no network or paid provider calls. It writes:

- `reports/current.json`: machine-readable scores, flags, pacing simulations and latency budget.
- `reports/blind-review.html`: neutral Variant A/B/C human-review sheet.

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

`configs/translation-configs.json` defines CURRENT and benchmark-only candidate prompts. Candidate outputs can be imported into a fixture or a separate local result file. The HTML report deliberately labels them Variant A/B/C. No candidate is promoted automatically.

Human reviewers score meaning, natural Dutch, religious integrity, completeness and overall preference. Automatic lexical flags support review but do not replace it.

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
- religious integrity ≥ 9/10 for every Qur'an/hadith case;
- dash use above 2 per 100 words triggers review, not automatic rejection.

WER/CER becomes reportable only for `human_verified` transcripts. Dialect spelling variation means it must be interpreted together with omissions, hallucinations and religious-term preservation.
