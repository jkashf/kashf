const assert = require('node:assert/strict');
const {
  PACER_CONFIG, estimateReadingTimeMs, splitForReading,
  createReadingPassages, calculateLag, ReadingPacer
} = require('../reading-pacer.js');

const words25 = Array.from({ length: 25 }, (_, index) => `woord${index}`).join(' ');
const expected25 = Math.round((25 / 170) * 60000 + PACER_CONFIG.breathingPauseMs);
assert.equal(estimateReadingTimeMs(words25), expected25, '170 WPM calculation must include breathing pause');
assert.equal(estimateReadingTimeMs('Korte zin.'), PACER_CONFIG.minimumDisplayMs, 'minimum display time must apply');

const sentenceA = Array.from({ length: 32 }, (_, index) => `a${index}`).join(' ') + '.';
const sentenceB = Array.from({ length: 31 }, (_, index) => `b${index}`).join(' ') + '.';
const largeTranslation = `${sentenceA} ${sentenceB}`;
const split = splitForReading(largeTranslation);
assert.deepEqual(split, [sentenceA, sentenceB], '30–55 word sentence groups should split naturally');
assert.equal(split.join(' '), largeTranslation, 'splitting must not lose or summarize content');
assert.ok(split.every(part => /\.$/.test(part)), 'never split in the middle of a sentence');

const longSingleSentence = Array.from({ length: 70 }, (_, index) => `lang${index}`).join(' ') + '.';
assert.deepEqual(splitForReading(longSingleSentence), [longSingleSentence], 'one long sentence must remain intact');

const unit = {
  sessionId: 'session', sequenceNumber: 4, timestamp: new Date(16000).toISOString(),
  translation: largeTranslation, originalTranscript: 'نص كامل',
  audioStartedAt: 0, audioEndedAt: 16000, mergedChunkCount: 2,
  flushReason: 'COMPLETE_THOUGHT', translationLatencyMs: 1200, liveLatencyMs: 19000
};
const passages = createReadingPassages(unit);
assert.equal(passages.length, 2);
assert.ok(passages.every(item => item.originalTranscript === 'نص كامل'));
assert.equal(passages.map(item => item.translation).join(' '), largeTranslation);

passages[0].shownAt = 20000;
const lag = calculateLag([passages[1]], passages[0], 30000);
assert.equal(lag.translationLagMs, 19000);
assert.equal(lag.readingLagMs, passages[1].estimatedReadingTimeMs);
assert.equal(lag.totalUserLagMs, 30000);
assert.notEqual(lag.translationLagMs, lag.readingLagMs, 'translation and reading lag must remain separate metrics');

(async () => {
  let now = 1000;
  const shown = [];
  const pacer = new ReadingPacer({ now: () => now, config: { minimumDisplayMs: 50, maximumDisplayMs: 50, breathingPauseMs: 0 }, onShow: passage => shown.push(passage) });
  pacer.enqueueUnit(unit);
  assert.equal(shown.length, 1, 'translation enters queue and only first reading passage becomes visible');
  assert.equal(pacer.queue.length, 1, 'background translation output may wait while current passage remains visible');
  assert.equal(pacer.current.id, passages[0].id);

  now += 20;
  pacer.pause();
  const frozenId = pacer.current.id;
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(pacer.current.id, frozenId, 'pause must freeze current passage');
  assert.equal(shown.length, 1);

  pacer.resume();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(shown.length, 2, 'resume continues from the same reading queue');
  assert.equal(shown[1].partNumber, 1);

  const all = pacer.stop();
  assert.equal(all.length, 2);
  assert.equal(all.map(item => item.translation).join(' '), largeTranslation, 'stop must retain shown and queued content in order');

  const growingUnit = { ...unit, sequenceNumber: 5, translation: sentenceA };
  const noSummaryPacer = new ReadingPacer({ config: { minimumDisplayMs: 100000, maximumDisplayMs: 100000 } });
  noSummaryPacer.enqueueUnit(unit);
  noSummaryPacer.enqueueUnit(growingUnit);
  assert.equal(noSummaryPacer.allInOrder().map(item => item.translation).join(' '), `${largeTranslation} ${sentenceA}`, 'growing queue must never summarize or drop content');
  noSummaryPacer.stop();

  console.log('reading pacer tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
