(function (root) {
  const enabled = root.location && (
    root.location.hostname === 'localhost'
    || root.location.hostname === '127.0.0.1'
    || root.location.hostname.endsWith('.vercel.app')
  );

  const ALLOWED_FIELDS = new Set([
    'sessionId', 'sequenceNumber', 'timestamp', 'startedAt', 'endedAt',
    'queueLength', 'currentPassageId', 'estimatedDisplayMs', 'timerRemainingMs',
    'isPaused', 'bufferSize', 'rejectReason', 'flushReason',
    'translationLagMs', 'readingLagMs', 'totalUserLagMs', 'mergedChunkCount',
    'audioToWhisperStartMs', 'whisperLatencyMs', 'transcriptionQueueWaitMs',
    'bufferWaitMs', 'translationQueueWaitMs', 'translationLatencyMs',
    'readingQueueWaitMs', 'totalLagMs', 'translationQueueLength',
    'bufferDurationMs', 'textLength', 'wordCount'
  ]);
  const events = [];

  function sanitize(metadata) {
    const safe = {};
    Object.entries(metadata || {}).forEach(([key, value]) => {
      if (!ALLOWED_FIELDS.has(key)) return;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) safe[key] = value;
    });
    return safe;
  }

  function log(event, metadata) {
    if (!enabled) return;
    const safeMetadata = sanitize(metadata);
    events.push({ event, metadata: safeMetadata });
    if (events.length > 5000) events.shift();
    console.info(`[Kashf lifecycle] ${event}`, safeMetadata);
  }

  function exportMetrics() {
    if (!enabled) return { schemaVersion: '1.0', exportedAt: new Date().toISOString(), events: [] };
    return {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      events: events.map(item => {
        const metadata = { ...item.metadata };
        delete metadata.sessionId;
        delete metadata.currentPassageId;
        return { event: item.event, metadata };
      })
    };
  }

  function downloadMetrics() {
    if (!enabled || !root.Blob || !root.URL) return false;
    const url = root.URL.createObjectURL(new Blob([JSON.stringify(exportMetrics(), null, 2)], { type: 'application/json' }));
    const link = root.document.createElement('a');
    link.href = url; link.download = `kashf-lifecycle-${Date.now()}.json`; link.click();
    root.URL.revokeObjectURL(url);
    return true;
  }

  root.KashfLifecycle = Object.freeze({ enabled: Boolean(enabled), log, sanitize, exportMetrics, downloadMetrics });
})(window);
