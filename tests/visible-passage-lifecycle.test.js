const assert = require('node:assert/strict');
const { KhutbahBuffer } = require('../khutbah-buffer.js');
const { ReadingPacer } = require('../reading-pacer.js');

function transcriptChunk() {
  return {
    sessionId: 'visible-session', sequenceNumber: 0, text: 'إن ذكر الله يطمئن القلوب.',
    startedAt: 0, endedAt: 16000, transcriptCompletedAt: 18000,
    timestamp: new Date(16000).toISOString(), transcriptLatencyMs: 2000
  };
}

async function runFlow(onLifecycle) {
  const allTranslations = [];
  const visiblePassages = [];
  const pacer = new ReadingPacer({
    config: { minimumDisplayMs: 100000, maximumDisplayMs: 100000 },
    onLifecycle,
    onShow: passage => visiblePassages.push(passage)
  });
  const buffer = new KhutbahBuffer({
    now: () => 20000,
    onLifecycle,
    onFlush: unit => {
      const translation = {
        sessionId: unit.sessionId, sequenceNumber: unit.sequenceNumber,
        timestamp: unit.timestamp, originalTranscript: unit.transcript,
        translation: 'Het gedenken van Allah brengt de harten tot rust.',
        audioStartedAt: unit.startedAt, audioEndedAt: unit.endedAt,
        mergedChunkCount: unit.mergedChunkCount, flushReason: unit.flushReason
      };
      allTranslations.push(translation);
      pacer.enqueueUnit(translation);
    }
  });
  await buffer.add(transcriptChunk());
  return { allTranslations, visiblePassages, pacer };
}

(async () => {
  const normal = await runFlow(() => {});
  assert.equal(normal.allTranslations.length, 1, 'valid buffered translation must enter allTranslations');
  assert.equal(normal.visiblePassages.length, 1, 'Reading Pacer must render a valid translated passage');
  assert.equal(normal.visiblePassages[0].translation, normal.allTranslations[0].translation);
  normal.pacer.stop();

  const brokenLifecycle = await runFlow(() => { throw new Error('intentional lifecycle failure'); });
  assert.equal(brokenLifecycle.allTranslations.length, 1, 'lifecycle failure must not block translation');
  assert.equal(brokenLifecycle.visiblePassages.length, 1, 'lifecycle failure must not block visible rendering');
  brokenLifecycle.pacer.stop();

  console.log('visible passage lifecycle fail-safe tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
