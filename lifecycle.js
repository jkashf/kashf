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
    'translationLagMs', 'readingLagMs', 'totalUserLagMs', 'mergedChunkCount'
  ]);

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
    console.info(`[Kashf lifecycle] ${event}`, sanitize(metadata));
  }

  root.KashfLifecycle = Object.freeze({ enabled: Boolean(enabled), log, sanitize });
})(window);
