const assert = require('node:assert/strict');
const {
  VAD_CONFIG, decideVad, filterTranscript, buildContext,
  buildTranslationPayload, insertPassageInOrder, isCurrentSession
} = require('../pipeline.js');

const silence = decideVad({ durationMs: 8000, totalFrames: 160, voicedFrames: 0, maximumRms: 0.003, maximumPeak: 0.01 });
assert.equal(silence.isSpeech, false, 'silence must be rejected');

const noiseSpike = decideVad({ durationMs: 8000, totalFrames: 160, voicedFrames: 1, maximumRms: 0.08, maximumPeak: 0.4 });
assert.equal(noiseSpike.isSpeech, false, 'a short noise spike must be rejected');
let providerCalls = 0;
if (silence.isSpeech) providerCalls += 1;
if (noiseSpike.isSpeech) providerCalls += 1;
assert.equal(providerCalls, 0, 'silence and noise must not trigger provider calls');

const speech = decideVad({ durationMs: 8000, totalFrames: 160, voicedFrames: 35, maximumRms: 0.04, maximumPeak: 0.12 });
assert.equal(speech.isSpeech, true, 'sustained speech-like energy must be accepted');
assert.equal(VAD_CONFIG.minimumVoicedDurationMs, 300);

assert.equal(filterTranscript('   ', '').code, 'NO_SPEECH');
assert.equal(filterTranscript('Alhamdulillah.', ' alhamdulillah ').code, 'DUPLICATE_TRANSCRIPT');
assert.equal(filterTranscript('Thank you for watching.', '').code, 'LIKELY_HALLUCINATION');
assert.equal(filterTranscript('De spreker gaat verder.', '').accepted, true);

let ordered = [];
ordered = insertPassageInOrder(ordered, { sequenceNumber: 2 });
ordered = insertPassageInOrder(ordered, { sequenceNumber: 0 });
ordered = insertPassageInOrder(ordered, { sequenceNumber: 1 });
assert.deepEqual(ordered.map(item => item.sequenceNumber), [0, 1, 2], 'out-of-order results must be sorted');

const passages = [
  { originalTranscript: 'Eerste onderwerp', translation: 'First topic' },
  { originalTranscript: 'Tweede onderwerp', translation: 'Second topic' }
];
const context = buildContext(passages);
assert.deepEqual(context.recentOriginals, ['Eerste onderwerp', 'Tweede onderwerp']);
assert.ok(!context.recentOriginals.includes('NIEUWE TEKST'), 'context may not fabricate or replace new text');

for (const targetLanguage of ['nl', 'en', 'fr']) {
  const payload = buildTranslationPayload({ transcript: 'NIEUWE TEKST', sourceLanguage: 'ar', targetLanguage, passages });
  assert.equal(payload.text, 'NIEUWE TEKST');
  assert.equal(payload.sourceLanguage, 'ar');
  assert.equal(payload.targetLanguage, targetLanguage);
  assert.deepEqual(payload.context, context);
}

assert.equal(isCurrentSession('current', 'current'), true);
assert.equal(isCurrentSession(null, 'current'), false, 'stopped sessions must reject results');
assert.equal(isCurrentSession('new', 'old'), false, 'old session results must be rejected');

require('../audio.js');
const audioController = new globalThis.KashfAudioController({ speechLanguages: {} });
audioController.active = true;
audioController.sessionId = 'active-session';
const inFlightRequest = new AbortController();
audioController.abortControllers.add(inFlightRequest);
audioController.stop();
assert.equal(inFlightRequest.signal.aborted, true, 'stopping a session must abort in-flight transcription');
assert.equal(audioController.isActive, false);

console.log('pipeline tests passed');
