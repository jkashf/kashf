import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile(new URL('../api/whisper.js', import.meta.url), 'utf8');
const whisper = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

assert.equal(whisper.evaluateSegment({ text: 'اشتركوا في القناة', no_speech_prob: 0.91, avg_logprob: -0.5, compression_ratio: 1.1 }).reason, 'no_speech_metadata');
assert.equal(whisper.evaluateSegment({ text: 'نص', no_speech_prob: 0.55, avg_logprob: -1.4, compression_ratio: 1.1 }).reason, 'low_log_probability');
assert.equal(whisper.evaluateSegment({ text: 'نص منخفض الصوت', no_speech_prob: 0.1, avg_logprob: -1.4, compression_ratio: 1.1 }).accepted, true, 'low log probability alone must not reject potentially real soft speech');
assert.equal(whisper.evaluateSegment({ text: 'نص', no_speech_prob: 0.1, avg_logprob: -0.3, compression_ratio: 2.8 }).reason, 'high_compression_ratio');
assert.equal(whisper.evaluateSegment({ text: 'هذا كلام واضح', no_speech_prob: 0.08, avg_logprob: -0.25, compression_ratio: 1.2 }).accepted, true);

console.log('whisper metadata filter tests passed');
