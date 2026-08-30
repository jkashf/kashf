const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const audioSource = fs.readFileSync(path.join(root, 'audio.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const bufferSource = fs.readFileSync(path.join(root, 'khutbah-buffer.js'), 'utf8');

assert.match(audioSource, /this\.dispatchTranscript\(data\.text\.trim\(\), metadata\)/);
assert.doesNotMatch(audioSource, /await this\.callbacks\.onTranscript/,
  'the ordered Whisper queue must not await downstream translation');
assert.match(appSource, /translationQueue=translationQueue\.then/,
  'Khutbah translation must use its own FIFO queue');
assert.match(appSource, /translationQueueLength\+\+/);
assert.doesNotMatch(bufferSource, /this\.queue = this\.queue\.then/,
  'KhutbahBuffer must not own the provider translation queue');

function simulate({ coupled }) {
  const durationMs = 10 * 60 * 1000;
  const chunkEveryMs = 8000;
  const whisperMs = 2000;
  const translationMs = 30000;
  let transcriptionAvailableAt = 0;
  let translationAvailableAt = 0;
  const transcriptionWaits = [];
  const completedSequences = [];

  for (let sequence = 0, arrival = 0; arrival < durationMs; sequence += 1, arrival += chunkEveryMs) {
    const whisperStartedAt = Math.max(arrival, transcriptionAvailableAt);
    transcriptionWaits.push(whisperStartedAt - arrival);
    const whisperCompletedAt = whisperStartedAt + whisperMs;
    completedSequences.push(sequence);

    if (coupled) {
      transcriptionAvailableAt = whisperCompletedAt + ((sequence + 1) % 3 === 0 ? translationMs : 0);
    } else {
      transcriptionAvailableAt = whisperCompletedAt;
      if ((sequence + 1) % 3 === 0) {
        const translationStartedAt = Math.max(whisperCompletedAt, translationAvailableAt);
        translationAvailableAt = translationStartedAt + translationMs;
      }
    }
  }
  return { transcriptionWaits, completedSequences, translationAvailableAt };
}

const before = simulate({ coupled: true });
const after = simulate({ coupled: false });
assert.equal(after.completedSequences.length, 75, 'all ten minutes of chunks must survive');
assert.deepEqual(after.completedSequences, Array.from({ length: 75 }, (_, index) => index),
  'transcripts must remain in sequence order');
assert.ok(before.transcriptionWaits.at(-1) > 200000,
  'the coupled architecture must demonstrate cumulative transcription delay');
assert.equal(Math.max(...after.transcriptionWaits), 0,
  'translation provider latency must not increase transcription queue wait');

console.log(JSON.stringify({
  simulationMinutes: 10,
  chunks: after.completedSequences.length,
  providerLatenciesMs: { whisper: 2000, translation: 30000 },
  before: { finalTranscriptionQueueWaitMs: before.transcriptionWaits.at(-1), maxTranscriptionQueueWaitMs: Math.max(...before.transcriptionWaits) },
  after: { finalTranscriptionQueueWaitMs: after.transcriptionWaits.at(-1), maxTranscriptionQueueWaitMs: Math.max(...after.transcriptionWaits) }
}, null, 2));
console.log('concurrency/backpressure tests passed');
