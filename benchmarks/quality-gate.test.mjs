import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { errorRate, textMetrics, hardFailures, scoreFixture, latencyBudget } from './lib/quality-gate.mjs';
import { comparison, tenMinuteScenarios, visibilityMs } from './lib/pacer-simulator.mjs';

const dataset = JSON.parse(await fs.readFile(new URL('./datasets/technical-v1.json', import.meta.url), 'utf8'));
const schemaSource = await fs.readFile(new URL('./schema.json', import.meta.url), 'utf8');
assert.ok(dataset.fixtures.every(item => ['synthetic', 'human_verified'].includes(item.verificationStatus)));
assert.ok(dataset.fixtures.some(item => item.languageProfile === 'non_speech'));
assert.equal(dataset.fixtures.filter(item => item.verificationStatus === 'human_verified').length, 0, 'v1 must not pretend synthetic Arabic/Darija is ground truth');
assert.ok(['darija', 'mixed_ar_darija'].every(profile => schemaSource.includes(profile)));

assert.equal(errorRate('a b c', 'a b c', 'word'), 0);
assert.equal(errorRate('a b c', 'a x c', 'word'), 1 / 3);
assert.equal(textMetrics('Tien woorden – en nog iets – als voorbeeld.').dashCount, 2);
assert.ok(textMetrics('Allah veel gedenken – mannen en vrouwen – iedere dag.').dashPer100Words > 2);
assert.equal(textMetrics('Allah ﷻ zegt:').emDashCount, 0);
assert.equal(textMetrics('Allah — verheven zij Zijn vermelding — zei:').emDashCount, 2);
assert.ok(textMetrics('Het doen herleven van het hart dat dood was.').translationeseSignalCount > 0);
assert.ok(textMetrics('Het zuiverste ervan, wat goed is.').unclearReferenceSignalCount > 0);
assert.deepEqual(hardFailures({ output: 'Allah ﷺ weet het.' }), ['WRONG_ALLAH_HONORIFIC']);
assert.deepEqual(hardFailures({ output: 'Allah عليه السلام weet het.' }), ['WRONG_ALLAH_HONORIFIC']);
assert.deepEqual(hardFailures({ output: 'Profeet Muhammad ﷻ zei het.' }), ['WRONG_PROPHET_HONORIFIC']);
assert.deepEqual(hardFailures({ output: 'I cannot provide a reliable translation.' }), ['META_OUTPUT']);
assert.deepEqual(hardFailures({ expectedDecision: 'reject', observedDecision: 'accept' }), ['SILENCE_HALLUCINATION_STORED']);
assert.deepEqual(hardFailures({ sequenceNumbers: [0, 2, 1] }), ['SEQUENCE_ORDER_CORRUPTION']);

for (const fixture of dataset.fixtures) {
  const result = scoreFixture(fixture);
  assert.equal(result.id, fixture.id);
  if (fixture.verificationStatus !== 'human_verified') assert.equal(result.automaticMetrics.wer, null);
  if (fixture.probeOutput) assert.deepEqual(hardFailures({ output: fixture.probeOutput }), fixture.expectedHardFailures);
}

const table = comparison();
assert.deepEqual(table.map(item => item.wordsPerMinute), [230, 245, 260, 275]);
assert.equal(table[0].passages.length, 6);
assert.equal(visibilityMs(10, { wordsPerMinute: 275 }), 5000);
assert.equal(visibilityMs(90, { wordsPerMinute: 230 }), 22000);

const scenarios = tenMinuteScenarios(245);
assert.equal(scenarios.length, 4);
assert.ok(scenarios.every(item => item.passageCount === 30));
assert.ok(scenarios.find(item => item.name === 'reader_faster_than_translation').summary.maxTranslationQueueWaitMs > 0);
assert.ok(scenarios.find(item => item.name === 'translation_faster_than_reader').summary.maxReadingQueueWaitMs >= 0);

const budget = latencyBudget({ audioCaptureMs: 8000, whisperLatencyMs: 2000, bufferWaitMs: 20000, translationLatencyMs: 5000 });
assert.equal(budget.totalUserVisibleLagMs, 35000);
assert.equal(budget.largestContributor, 'bufferWaitMs');

console.log('quality gate tests passed');
