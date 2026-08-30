const assert = require('node:assert/strict');
const {
  PACER_CONFIG, estimateReadingTimeMs, splitForReading,
  createReadingPassages, calculateLag, ReadingPacer
} = require('../reading-pacer.js');

const words25 = Array.from({ length: 25 }, (_, index) => `woord${index}`).join(' ');
const expected25 = Math.round((25 / 210) * 60000);
assert.equal(estimateReadingTimeMs(words25), expected25, '210 WPM calculation must define the minimum comfortable reading time');
assert.equal(estimateReadingTimeMs('Korte zin.'), PACER_CONFIG.minimumDisplayMs, 'minimum display time must apply');

const visibilityExamples = [20, 35, 50, 70].map(wordCount => {
  const text = Array.from({ length: wordCount }, (_, index) => `w${index}`).join(' ');
  return {
    wordCount,
    oldMs: Math.round(Math.min(26000, Math.max(6500, (wordCount / 170) * 60000 + 1800))),
    newMs: estimateReadingTimeMs(text)
  };
});
assert.deepEqual(visibilityExamples.map(item => item.newMs), [5714, 10000, 14286, 20000]);

const sentenceA = Array.from({ length: 32 }, (_, index) => `a${index}`).join(' ') + '.';
const sentenceB = Array.from({ length: 31 }, (_, index) => `b${index}`).join(' ') + '.';
const largeTranslation = `${sentenceA} ${sentenceB}`;
const split = splitForReading(largeTranslation);
assert.deepEqual(split, [sentenceA, sentenceB], '30–55 word sentence groups should split naturally');
assert.equal(split.join(' '), largeTranslation, 'splitting must not lose or summarize content');
assert.ok(split.every(part => /\.$/.test(part)), 'never split in the middle of a sentence');

const longSingleSentence = Array.from({ length: 70 }, (_, index) => `lang${index}`).join(' ') + '.';
assert.deepEqual(splitForReading(longSingleSentence), [longSingleSentence], 'one long sentence must remain intact');
const quotedThought = 'De imam zei: “Gedenk Allah wanneer je alleen bent en wanneer je samenkomt.” Daarna vervolgde hij zijn uitleg.';
assert.equal(splitForReading(quotedThought).join(' '), quotedThought, 'quoted content must remain complete and unchanged');
assert.ok(splitForReading('Het gedenken, dienaren van Allah, brengt het hart tot rust. Daarna volgt dankbaarheid.').every(part => !/,$/.test(part)), 'a visible passage must not end at a comma');

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

  const waitingShown = [];
  const waitingPacer = new ReadingPacer({ config: { minimumDisplayMs: 20, maximumDisplayMs: 20, breathingPauseMs: 0 }, onShow: passage => waitingShown.push(passage) });
  waitingPacer.enqueueUnit({ ...unit, sequenceNumber: 20, translation: 'Passage zonder opvolger.' });
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(waitingPacer.current.sequenceNumber, 20, 'elapsed minimum time with an empty queue must retain the current passage');
  waitingPacer.enqueueUnit({ ...unit, sequenceNumber: 21, translation: 'Later binnengekomen opvolger.' });
  assert.equal(waitingShown.length, 2, 'a later passage must wake an elapsed pacer immediately');
  assert.equal(waitingShown[1].sequenceNumber, 21);
  waitingPacer.stop();

  const all = pacer.stop();
  assert.equal(all.length, 2);
  assert.equal(all.map(item => item.translation).join(' '), largeTranslation, 'stop must retain shown and queued content in order');

  const growingUnit = { ...unit, sequenceNumber: 5, translation: sentenceA };
  const noSummaryPacer = new ReadingPacer({ config: { minimumDisplayMs: 100000, maximumDisplayMs: 100000 } });
  noSummaryPacer.enqueueUnit(unit);
  noSummaryPacer.enqueueUnit(growingUnit);
  assert.equal(noSummaryPacer.allInOrder().map(item => item.translation).join(' '), `${largeTranslation} ${sentenceA}`, 'growing queue must never summarize or drop content');
  noSummaryPacer.stop();

  // Regression: two minutes of pipeline output while the first passage is visible.
  const lifecycle = [];
  const continuousShown = [];
  const continuousHistory = [];
  const continuousPacer = new ReadingPacer({
    config: { minimumDisplayMs: 15, maximumDisplayMs: 15, breathingPauseMs: 0 },
    onShow: passage => continuousShown.push(passage),
    onLifecycle: (event, metadata) => lifecycle.push({ event, metadata })
  });
  for (let sequenceNumber = 0; sequenceNumber < 15; sequenceNumber += 1) {
    const translatedUnit = {
      ...unit,
      sequenceNumber,
      timestamp: new Date(sequenceNumber * 8000).toISOString(),
      translation: `Volledige passage nummer ${sequenceNumber}.`,
      originalTranscript: `transcript-${sequenceNumber}`,
      audioStartedAt: sequenceNumber * 8000,
      audioEndedAt: (sequenceNumber + 1) * 8000
    };
    continuousHistory.push(translatedUnit);
    continuousPacer.enqueueUnit(translatedUnit);
  }
  assert.equal(continuousHistory.length, 15, 'translation history must continue for at least two minutes of chunks');
  assert.equal(continuousShown.length, 1, 'passage A stays visible while B/C/D independently accumulate');
  assert.equal(continuousPacer.queue.length, 14);
  await new Promise(resolve => setTimeout(resolve, 750));
  assert.equal(continuousShown.length, 15, 'pacer must automatically advance through B, C and later passages');
  assert.deepEqual(continuousShown.map(item => item.sequenceNumber), Array.from({ length: 15 }, (_, index) => index));
  assert.equal(continuousPacer.allInOrder().length, 15, 'no translated unit may disappear');
  assert.ok(lifecycle.some(item => item.event === 'PACER_ENQUEUE'));
  assert.ok(lifecycle.some(item => item.event === 'PACER_SHOW'));
  assert.ok(lifecycle.some(item => item.event === 'PACER_ADVANCE'));

  // Exact iPhone regression: queue drains, then later work must wake the pacer again.
  const wakeShown = [];
  const wakePacer = new ReadingPacer({
    config: { minimumDisplayMs: 15, maximumDisplayMs: 15, breathingPauseMs: 0 },
    onShow: passage => wakeShown.push(passage)
  });
  wakePacer.enqueueUnit({ ...unit, sequenceNumber: 100, translation: 'Eerste passage.' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(wakePacer.current.sequenceNumber, 100, 'the last passage must remain visible while the queue is empty');
  wakePacer.enqueueUnit({ ...unit, sequenceNumber: 101, translation: 'Latere passage.' });
  assert.equal(wakeShown.length, 2, 'later arriving passage must restart an idle pacer immediately');
  assert.equal(wakeShown[1].sequenceNumber, 101);

  // Separate full pause/resume regression after the original active-session bug.
  wakePacer.pause();
  wakePacer.enqueueUnit({ ...unit, sequenceNumber: 102, translation: 'Passage tijdens pauze.' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(wakeShown.length, 2, 'pause must not show new work');
  wakePacer.resume();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(wakeShown.length, 3, 'resume must continue the preserved queue');
  assert.equal(wakeShown[2].sequenceNumber, 102);
  continuousPacer.stop();
  wakePacer.stop();

  console.log(JSON.stringify({ visibilityExamples }, null, 2));
  console.log('reading pacer tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
