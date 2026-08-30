import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { materializeManifest, validateFixture, fixtureStatus, segmentPlan, AUDIO_FORMATS } from './lib/real-audio.mjs';
import { STT_CONFIGS, normalizeSttResult, requestPlan, assertLiveOptIn, runSttAdapter } from './lib/stt-adapters.mjs';
import { buildTranslationTracks } from './lib/translation-tracks.mjs';
import { blindVariants, serializeReview, aggregateReviews } from './lib/review.mjs';
import { percentile, statistics, detectQueueGrowth, analyzeLifecycle } from './lib/lifecycle-analyzer.mjs';
import { compareLifecyclePacing } from './lib/pacer-simulator.mjs';

const manifest = JSON.parse(await fs.readFile(new URL('./datasets/real-audio-core-v1.json', import.meta.url), 'utf8'));
const fixtures = materializeManifest(manifest);
assert.equal(fixtures.length, 18);
assert.deepEqual(AUDIO_FORMATS, ['.mp3', '.m4a', '.wav', '.webm']);
assert.ok(fixtures.some(item => item.languageProfile === 'ar'));
assert.ok(fixtures.some(item => item.languageProfile === 'darija'));
assert.ok(fixtures.some(item => item.languageProfile === 'mixed_ar_darija'));
assert.ok(fixtures.every(item => item.humanVerified === false));
assert.ok(fixtures.every(item => item.provenance.allowedForLocalBenchmark === false));
assert.equal(validateFixture({ ...fixtures[0], file: 'clip.flac' }, '.').errors[0], 'UNSUPPORTED_AUDIO_FORMAT');
assert.ok(validateFixture({ ...fixtures[0], file: 'clip.wav' }, '.').errors.includes('FORBIDDEN_BY_PERMISSION'));
assert.equal((await fixtureStatus(fixtures[0], '.')).status, 'not_run');

const switchFixture = { ...fixtures[8], expectedLanguageSwitches: [{ startMs: 0, endMs: 12000, profile: 'ar' }, { startMs: 12000, endMs: 28000, profile: 'darija' }, { startMs: 28000, endMs: 40000, profile: 'mixed_within_segment' }] };
assert.equal(validateFixture(switchFixture, '.').valid, true);
assert.equal(segmentPlan(65, 20).length, 4);

assert.equal(STT_CONFIGS.current_stt.language, 'ar');
assert.equal(STT_CONFIGS.whisper_auto.language, null);
assert.equal(STT_CONFIGS.gpt4o_mini_transcribe.responseFormat, 'json');
assert.equal(STT_CONFIGS.gpt4o_transcribe.responseFormat, 'json');
const whisper = normalizeSttResult({ configuration: 'current_stt', response: { text: 'نص', language: 'ar', segments: [{ start: 0, end: 1, text: 'نص', no_speech_prob: .1 }] }, latencyMs: 1200 });
assert.equal(whisper.segments[0].noSpeechProbability, .1);
const rejectedWhisper = normalizeSttResult({ configuration: 'current_stt', response: { text: 'اشتركوا', segments: [{ text: 'اشتركوا', no_speech_prob: .9 }] } });
assert.equal(rejectedWhisper.accepted, false);
assert.equal(rejectedWhisper.rejectionReason, 'NO_SPEECH_METADATA');
const gpt4o = normalizeSttResult({ configuration: 'gpt4o_transcribe', response: { text: 'نص', logprobs: [], usage: { total_tokens: 12 } }, latencyMs: 900 });
assert.deepEqual(gpt4o.segments, [], 'Whisper segment filters must not be invented for GPT-4o transcribe');
assert.equal(gpt4o.providerMetadata.logprobsAvailable, true);

const tracksMissing = buildTranslationTracks(fixtures[0], [whisper]);
assert.ok(tracksMissing.some(item => item.track === 'reference_transcript' && item.status === 'not_run'));
assert.ok(tracksMissing.some(item => item.track === 'stt_output' && item.status === 'ready'));
const verified = { ...fixtures[0], humanVerified: true, referenceTranscript: 'مرجع' };
assert.ok(buildTranslationTracks(verified, []).every(item => item.track !== 'reference_transcript' || item.status === 'ready'));

const outputs = { current: 'een', candidate_a: 'twee', candidate_b: 'drie', candidate_c: 'vier' };
assert.deepEqual(blindVariants(outputs, 'seed', 'fixture'), blindVariants(outputs, 'seed', 'fixture'));
assert.notDeepEqual(blindVariants(outputs, 'seed', 'fixture'), blindVariants(outputs, 'other-seed', 'fixture'));
const review1 = serializeReview({ fixtureId: 'f', reviewerId: 'r1', variantScores: { 'Variant A': { meaningFidelity: 8 } }, preferredVariant: 'Variant A' });
const review2 = serializeReview({ fixtureId: 'f', reviewerId: 'r2', variantScores: { 'Variant A': { meaningFidelity: 9 } }, preferredVariant: 'Variant A' });
const aggregated = aggregateReviews([review1, review2])[0];
assert.equal(aggregated.reviewerCount, 2);
assert.equal(aggregated.preferredVariantAgreement, true);
assert.equal(aggregated.requiresSecondReviewer, false);

assert.equal(percentile([1, 2, 3, 4, 100], .5), 3);
assert.equal(statistics([1, 2, 3, 4, 100]).p90, 100);
assert.equal(statistics([1, 2, 3, 4, 100]).p95, 100);
const growthEvents = [0, 500, 1000, 1500, 2000].map(value => ({ metadata: { translationQueueWaitMs: value } }));
assert.equal(detectQueueGrowth(growthEvents).detected, true);
const lifecycle = JSON.parse(await fs.readFile(new URL('./datasets/lifecycle-dry-run.json', import.meta.url), 'utf8'));
const analysis = analyzeLifecycle(lifecycle);
assert.equal(analysis.metrics.totalLagMs.count, 4);
assert.equal(analysis.buffer.flushReasonCounts.COMPLETE_THOUGHT, 1);
assert.equal(analysis.buffer.averageUnitDurationMs, 16000);
assert.equal(analysis.buffer.averageCharsPerUnit, 180);
assert.ok(Number.isFinite(analysis.translation.unitArrivalRatePerMinute));
const pacing = compareLifecyclePacing(lifecycle);
assert.equal(pacing.length, 10);
assert.ok(pacing.every(item => Object.hasOwn(item, 'accumulatedReadingLagMs')));

const statuses = await Promise.all(fixtures.map(item => fixtureStatus(item, '.')));
const plan = requestPlan(statuses, Object.keys(STT_CONFIGS), ['current', 'candidate_a', 'candidate_b', 'candidate_c']);
assert.equal(plan.runnableFixtures, 0);
assert.equal(plan.estimatedSttRequests, 0);
assert.throws(() => assertLiveOptIn([]), /EXPLICIT_CONFIRMATION/);
assert.equal(assertLiveOptIn(['--confirm-live']), true);
await assert.rejects(() => runSttAdapter({ configuration: 'current_stt', fileBytes: new Uint8Array(), filename: 'x.wav', mimeType: 'audio/wav', apiKey: 'test' }), /EXPLICIT_CONFIRMATION/);
let capturedBody;
const liveResult = await runSttAdapter({ configuration: 'whisper_auto', fileBytes: new Uint8Array([1, 2]), filename: 'x.wav', mimeType: 'audio/wav', apiKey: 'test', confirmed: true, fetchImpl: async (_url, options) => { capturedBody = options.body; return { ok: true, json: async () => ({ text: 'test', segments: [] }) }; } });
assert.equal(liveResult.text, 'test');
assert.equal(capturedBody.has('language'), false, 'WHISPER_AUTO must omit the language field');

const lifecycleSource = await fs.readFile(new URL('../lifecycle.js', import.meta.url), 'utf8');
assert.match(lifecycleSource, /delete metadata\.sessionId/);
assert.match(lifecycleSource, /delete metadata\.currentPassageId/);
assert.doesNotMatch(lifecycleSource, /originalTranscript|translation:/);
const gitignore = await fs.readFile(new URL('../.gitignore', import.meta.url), 'utf8');
assert.match(gitignore, /benchmarks\/fixtures\/audio\/\*/);
assert.match(gitignore, /benchmarks\/reviews\/local\/\*/);

console.log('phase 2 real-audio evaluation tests passed');
