export function percentile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.ceil((sorted.length - 1) * ratio)];
}

export function statistics(values) {
  const clean = values.filter(Number.isFinite);
  return { count: clean.length, min: clean.length ? Math.min(...clean) : null, p50: percentile(clean, .5), p90: percentile(clean, .9), p95: percentile(clean, .95), max: clean.length ? Math.max(...clean) : null };
}

export function detectQueueGrowth(events, field = 'translationQueueWaitMs', minimumSamples = 5) {
  const values = events.map(item => Number(item.metadata?.[field])).filter(Number.isFinite);
  if (values.length < minimumSamples) return { detected: false, reason: 'INSUFFICIENT_SAMPLES', sampleCount: values.length };
  let nonDecreasing = 0;
  for (let index = 1; index < values.length; index += 1) if (values[index] >= values[index - 1]) nonDecreasing += 1;
  const slope = (values.at(-1) - values[0]) / (values.length - 1);
  return { detected: nonDecreasing / (values.length - 1) >= .8 && slope > 250, flag: 'TRANSLATION_QUEUE_GROWTH', sampleCount: values.length, slopeMsPerSample: slope };
}

export function analyzeLifecycle(exportData) {
  const events = Array.isArray(exportData?.events) ? exportData.events : [];
  const metricNames = ['audioToWhisperStartMs', 'transcriptionQueueWaitMs', 'whisperLatencyMs', 'bufferWaitMs', 'translationQueueWaitMs', 'translationLatencyMs', 'readingQueueWaitMs', 'totalLagMs'];
  const metrics = Object.fromEntries(metricNames.map(name => [name, statistics(events.map(event => Number(event.metadata?.[name])))]));
  const flushes = events.filter(event => event.event === 'BUFFER_FLUSH');
  const translations = events.filter(event => event.event === 'TRANSLATION_DONE');
  const elapsedMinutes = events.length > 1 ? Math.max(1 / 60, ((events.at(-1).metadata?.timestamp || 0) - (events[0].metadata?.timestamp || 0)) / 60000) : null;
  const firstWhisper = events.find(event => event.event === 'WHISPER_ACCEPT');
  const firstTranslation = translations[0];
  const firstTimestamp = events[0]?.metadata?.timestamp || null;
  const lastTimestamp = events.at(-1)?.metadata?.timestamp || null;
  return {
    sessionDurationMs: Number.isFinite(firstTimestamp) && Number.isFinite(lastTimestamp) ? lastTimestamp - firstTimestamp : null,
    audioChunkCount: events.filter(event => event.event === 'AUDIO_CHUNK').length,
    firstTranscriptLatencyMs: firstWhisper?.metadata?.whisperLatencyMs ?? null,
    firstTranslationLatencyMs: firstTranslation?.metadata?.translationLatencyMs ?? null,
    metrics,
    steadyStateTotalLag: statistics(events.slice(Math.floor(events.length * .2)).map(event => Number(event.metadata?.totalLagMs))),
    maximumTotalLagMs: metrics.totalLagMs.max,
    buffer: { flushReasonCounts: flushes.reduce((counts, event) => ({ ...counts, [event.metadata?.flushReason || 'UNKNOWN']: (counts[event.metadata?.flushReason || 'UNKNOWN'] || 0) + 1 }), {}), bufferWaitMs: metrics.bufferWaitMs, averageUnitDurationMs: average(flushes.map(event => Number(event.metadata?.bufferDurationMs))), averageChunksPerUnit: average(flushes.map(event => Number(event.metadata?.mergedChunkCount))), averageCharsPerUnit: average(flushes.map(event => Number(event.metadata?.textLength))) },
    translation: { latencyMs: metrics.translationLatencyMs, queueWaitMs: metrics.translationQueueWaitMs, queueLength: statistics(events.map(event => Number(event.metadata?.translationQueueLength))), unitArrivalRatePerMinute: elapsedMinutes ? translations.length / elapsedMinutes : null, serviceRatePerMinute: elapsedMinutes ? translations.filter(event => Number.isFinite(event.metadata?.translationLatencyMs)).length / elapsedMinutes : null, growth: detectQueueGrowth(events) }
  };
}
function average(values) { const clean = values.filter(Number.isFinite); return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null; }
