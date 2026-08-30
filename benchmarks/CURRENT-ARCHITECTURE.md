# Current production baseline

## End-to-end flow

`MediaRecorder (8 s chunks) → VAD → serial Whisper queue → immediate transcript dispatch → transcript filters → KhutbahBuffer → independent FIFO translation queue (concurrency 1) → validated allTranslations in sequence order → independent Reading Pacer`

Whisper never awaits translation or Reading Pacer. The benchmark directory is not imported by production code.

## Source-language assumptions

The user selects a single source language for the session. Khutbah defaults to `ar`. `audio.js` sends that value as `srcLang` for every chunk. The browser SpeechRecognition fallback sets one session-wide locale such as `ar-SA`.

For `/api/whisper`, `srcLang=ar` maps to `ar`, and the multipart request includes `language=ar`. `ber` is the only configured choice mapped to `null`, which omits the language field. There is no `darija` or `mixed_ar_darija` production source-language profile.

Therefore Arabic is explicitly forced in the normal Arabic Khutbah flow. Darija in Arabic script may still be transcribed, but automatic language identification is constrained and Arabic/Darija/French code-switches may be normalised, omitted or misrecognised. Current filters do not intentionally reject Darija vocabulary, but cannot recover words already lost by STT.

## Exact Whisper request

- endpoint: `POST https://api.openai.com/v1/audio/transcriptions`
- model: `whisper-1`
- multipart file with recorded MIME type
- `response_format=verbose_json`
- `timestamp_granularities[]=segment`
- `language=<mapped session source language>` when mapping is non-null
- no Whisper prompt/context field

Accepted segment metadata: `no_speech_prob`, `avg_logprob`, and `compression_ratio`. Current thresholds are 0.72 maximum no-speech probability, -1.0 minimum average log probability combined with no-speech ≥ 0.45, and 2.4 maximum compression ratio. Client-side VAD, boilerplate filters, duplicate filtering and conservative weak-short-transcript checks are additional layers.

## Translation request and context

The client sends the same session-wide source code (`ar`) to `/api/translate`. The user message labels it `BRONTAAL: ar`; the system prompt itself asks for direct source-to-target translation but does not explicitly describe Darija/code-switching. Production model is `claude-haiku-4-5-20251001`, `max_tokens=400`, translation concurrency 1.

Context contains up to four recent original transcripts and four recent translations, capped at 1,800 characters per list, plus detected introduced terms. Context is for reference consistency and must not be retranslated.

Risks across Arabic↔Darija switches:

- the fixed `ar` label can bias both STT and translator toward MSA;
- French loans or phonetic Darija forms may be mistranscribed before translation;
- a mistaken prior transcript can influence pronoun/term interpretation in later context;
- the context has no per-passage detected-language metadata;
- the prompt forbids replaying old content, but model repetition remains a behavior requiring evaluation;
- Qur'an followed by Darija explanation is not explicitly typed, so text-type recognition is model-dependent.

No production language hint, model, filter, queue, buffer or pacing parameter was changed in Quality Gate v1.
