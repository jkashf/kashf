const assert = require('node:assert/strict');
const { BUFFER_CONFIG, evaluateShortTranscript, decideFlush, createUnit, KhutbahBuffer } = require('../khutbah-buffer.js');

function chunk(sequenceNumber, text, startedAt, endedAt, extras = {}) {
  return { sessionId: 'session', sequenceNumber, text, startedAt, endedAt, timestamp: new Date(endedAt).toISOString(), ...extras };
}

const multiple = [chunk(0, 'إن الإيمان', 0, 8000), chunk(1, 'يظهر في العمل.', 8000, 16000)];
const unit = createUnit(multiple, 'COMPLETE_THOUGHT', 20000);
assert.equal(unit.mergedChunkCount, 2);
assert.equal(unit.transcript, 'إن الإيمان يظهر في العمل.');

let decision = decideFlush(multiple, 20000);
assert.equal(decision.flush, true);
assert.equal(decision.reason, 'COMPLETE_THOUGHT');

decision = decideFlush([chunk(0, 'فكرة مستمرة', 0, 8000)], BUFFER_CONFIG.softMaximumLatencyMs + 1);
assert.equal(decision.flush, true);
assert.equal(decision.reason, 'SOFT_MAX_LATENCY');

decision = decideFlush([chunk(0, 'نص طويل بدون نهاية', 0, 8000)], BUFFER_CONFIG.hardMaximumLatencyMs + 1);
assert.equal(decision.reason, 'HARD_MAX_LATENCY');
const hardUnit = createUnit([chunk(0, 'كل التفاصيل تبقى', 0, 8000)], decision.reason, BUFFER_CONFIG.hardMaximumLatencyMs + 1);
assert.equal(hardUnit.transcript, 'كل التفاصيل تبقى', 'hard max must not summarize or omit text');

const weakCough = evaluateShortTranscript('شكرا', {
  vad: { voicedRatio: 0.06, voicedDurationMs: 350 },
  transcriptionQuality: { maximumNoSpeechProbability: 0.48, minimumAverageLogProbability: -0.82 }
});
assert.equal(weakCough.accepted, false);
assert.equal(weakCough.reason, 'SHORT_TRANSCRIPT_WEAK_AUDIO');

const realShortSpeech = evaluateShortTranscript('شكرا', {
  vad: { voicedRatio: 0.42, voicedDurationMs: 1800 },
  transcriptionQuality: { maximumNoSpeechProbability: 0.08, minimumAverageLogProbability: -0.22 }
});
assert.equal(realShortSpeech.accepted, true, 'real short speech must not be blindly rejected');

(async () => {
  const flushed = [];
  let now = 0;
  const buffer = new KhutbahBuffer({ now: () => now, onFlush: async value => flushed.push(value) });
  await buffer.add(chunk(0, 'الجزء الأول', 0, 8000));
  assert.equal(flushed.length, 0);
  now = 16000;
  await buffer.add(chunk(1, 'والجزء الثاني.', 8000, 16000));
  assert.equal(flushed.length, 1, 'chunk boundaries must produce one UI translation unit');
  assert.equal(flushed[0].mergedChunkCount, 2);
  assert.equal(buffer.pendingChunkCount, 0);

  const history = flushed.slice();
  assert.equal(history.length, 1, 'successful unit remains internally available');

  const timedFlushes = [];
  const timedBuffer = new KhutbahBuffer({
    config: { softMaximumLatencyMs: 15 },
    now: () => 0,
    onFlush: async value => timedFlushes.push(value)
  });
  await timedBuffer.add(chunk(0, 'waiting thought', 0, 8000));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(timedFlushes.length, 1, 'maximum wait timer must force a flush');
  assert.equal(timedFlushes[0].flushReason, 'SOFT_MAX_TIMER');

  const recoveryFlushes = [];
  let recoveryNow = BUFFER_CONFIG.softMaximumLatencyMs + 1;
  const recoveryBuffer = new KhutbahBuffer({ now: () => recoveryNow, onFlush: async value => recoveryFlushes.push(value) });
  await recoveryBuffer.add(chunk(0, 'latency pressure', 0, 8000));
  assert.equal(recoveryBuffer.recoveryMode, true, 'soft latency pressure must enable smaller recovery units');
  recoveryNow += 8000;
  await recoveryBuffer.add(chunk(1, 'next part', recoveryNow - 8000, recoveryNow));
  recoveryNow += 8000;
  await recoveryBuffer.add(chunk(2, 'continued thought', recoveryNow - 8000, recoveryNow));
  assert.equal(recoveryFlushes.length, 2, 'recovery mode must use at most two chunks for the next unit');
  assert.equal(recoveryFlushes[1].flushReason, 'MAX_CHUNK_COUNT');

  await buffer.add(chunk(2, 'محتوى موثوق', 16000, 24000));
  await buffer.pause();
  assert.equal(flushed.length, 2, 'pause may emit at most one final buffered unit');
  assert.equal(flushed[1].flushReason, 'PAUSE_FLUSH');
  assert.equal(buffer.pendingChunkCount, 0);
  console.log('khutbah buffer tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
