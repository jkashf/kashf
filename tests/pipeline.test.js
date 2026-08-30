const assert = require('node:assert/strict');
const {
  VAD_CONFIG, decideVad, filterTranscript, buildContext,
  buildTranslationPayload, insertPassageInOrder, isCurrentSession,
  MERGE_CONFIG, decidePendingTranscript, shouldHoldTranscript, hasSentenceEnding
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
assert.equal(filterTranscript('اشتركوا في القناة', '').code, 'LIKELY_HALLUCINATION');
assert.equal(filterTranscript('قال لهم اشتركوا في القناة التعليمية لتصلكم الدروس', '').accepted, true, 'real longer sentence containing the words must not be blindly rejected');
assert.equal(filterTranscript('De spreker gaat verder.', '').accepted, true);

const firstHalf = decidePendingTranscript('', 'إن المؤمن إذا أخطأ');
assert.equal(firstHalf.hold, true, 'short unfinished chunk must wait');
const completedThought = decidePendingTranscript(firstHalf.text, 'عاد إلى الله بالتوبة.');
assert.equal(completedThought.hold, false);
assert.equal(completedThought.text, 'إن المؤمن إذا أخطأ عاد إلى الله بالتوبة.');
assert.equal(shouldHoldTranscript('هذه جملة كاملة.'), false, 'complete sentence must not be delayed');
assert.equal(hasSentenceEnding('Het gedenken, dienaren van Allah,'), false, 'a comma must not become a semantic boundary');
assert.equal(hasSentenceEnding('De imam zei:'), false, 'a colon must not flush before what follows');
assert.equal(shouldHoldTranscript('Daarom'), true, 'a connector ending should wait where latency permits');
assert.equal(MERGE_CONFIG.maximumWaitMs, 9500);

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
assert.deepEqual(context.introducedIslamicTerms, []);

const firstTaqwaContext = buildContext([{ originalTranscript: 'التقوى', translation: 'Taqwa (bewust leven met ontzag voor Allah ﷻ) beschermt het hart.' }]);
assert.deepEqual(firstTaqwaContext.introducedIslamicTerms, ['taqwa'], 'first successful introduction must mark taqwa as introduced');
const followupTaqwaPayload = buildTranslationPayload({ transcript: 'والتقوى هنا', sourceLanguage: 'ar', targetLanguage: 'nl', passages: [{ originalTranscript: 'التقوى', translation: 'Taqwa (bewust leven met ontzag voor Allah ﷻ) beschermt het hart.' }] });
assert.deepEqual(followupTaqwaPayload.context.introducedIslamicTerms, ['taqwa'], 'follow-up must tell the translator not to repeat the explanation');

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
