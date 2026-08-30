import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { hardFailures, textMetrics, QUALITY_THRESHOLDS } from './lib/quality-gate.mjs';
import { REVIEW_FLAGS, REVIEW_RUBRIC } from './lib/review.mjs';

const contract = await fs.readFile(new URL('./contracts/kashf-translation-style-v1.md', import.meta.url), 'utf8');
const prompt = await fs.readFile(new URL('./prompts/candidate-c.txt', import.meta.url), 'utf8');
const configs = JSON.parse(await fs.readFile(new URL('./configs/translation-configs.json', import.meta.url), 'utf8'));
const observed = JSON.parse(await fs.readFile(new URL('./datasets/observed-production-readability-v1.json', import.meta.url), 'utf8'));

assert.match(contract, /If a normal Dutch reader must reread/);
assert.match(contract, /emDashCount = 0/);
assert.match(contract, /Allah ﷻ/u);
assert.match(contract, /Qur'an quotations require stricter meaning fidelity/);
assert.match(prompt, /Return only the Dutch translation/);
assert.match(prompt, /Do not use the em dash/);
assert.equal(configs.current.production, true);
assert.equal(configs.candidate_a.production, false);
assert.equal(configs.candidate_b.production, false);
assert.equal(configs.candidate_c.production, false);
assert.equal(configs.candidate_c.promptSource, 'benchmarks/prompts/candidate-c.txt');

assert.equal(observed.verificationStatus, 'observed_production_output');
assert.equal(observed.fixtures.length, 8);
for (const fixture of observed.fixtures) {
  const metrics = textMetrics(fixture.output);
  for (const expected of fixture.expectedSignals.filter(signal => signal !== 'review_required')) {
    assert.ok(metrics.readabilityWarnings.includes(expected), `${fixture.id} should expose ${expected}`);
  }
}

const metrics = textMetrics('Dit is een heldere zin. Dit is ook direct begrijpelijk.');
assert.equal(metrics.emDashCount, 0);
assert.equal(metrics.longSentenceCount, 0);
assert.equal(metrics.nestedClauseRisk, 0);
assert.equal(textMetrics('Allah — verheven zij Zijn vermelding — zei:').emDashCount, 2);
assert.ok(textMetrics(`Dit is een zin met veel woorden die bewust blijft doorgaan omdat de structuur meerdere gedachten opstapelt terwijl de lezer moet onthouden wat eerder werd gezegd en waardoor de kern pas heel laat duidelijk wordt.`).longSentenceCount > 0);

for (const good of ['Allah ﷻ', 'de Profeet ﷺ', 'Muhammad ﷺ', 'Musa عليه السلام', 'Abu Bakr رضي الله عنه', 'Ibn al-Qayyim رحمه الله']) {
  assert.deepEqual(hardFailures({ output: good }), [], `${good} must be accepted`);
}
assert.deepEqual(hardFailures({ output: 'Allah ﷺ' }), ['WRONG_ALLAH_HONORIFIC']);
assert.deepEqual(hardFailures({ output: 'Allah عليه السلام' }), ['WRONG_ALLAH_HONORIFIC']);
assert.deepEqual(hardFailures({ output: 'Profeet Muhammad ﷻ' }), ['WRONG_PROPHET_HONORIFIC']);
const literalBlock = textMetrics('Ibn al-Qayyim — Allah zij barmhartig voor hem — zei:');
assert.equal(literalBlock.literalHonorificSignalCount, 1);
assert.ok(literalBlock.readabilityWarnings.includes('literal_honorific'));

assert.equal(QUALITY_THRESHOLDS.firstReadComprehensionHumanAverage, 8.5);
assert.equal(REVIEW_RUBRIC.firstReadComprehension.seriousCaseReviewBelow, 7);
for (const flag of ['reread_required', 'translationese', 'excessive_dash', 'confusing_honorific', 'unclear_pronoun_reference', 'sentence_structure_too_complex']) assert.ok(REVIEW_FLAGS.includes(flag));

console.log('translation style contract and readability tests passed');
