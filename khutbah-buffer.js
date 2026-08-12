(function (root, factory) {
  const api = factory(root.KashfPipeline || (typeof require === 'function' ? require('./pipeline.js') : null));
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KashfKhutbahBuffer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (pipeline) {
  const BUFFER_CONFIG = Object.freeze({
    targetLatencyMs: 20000,
    softMaximumLatencyMs: 30000,
    hardMaximumLatencyMs: 40000,
    minimumUnitDurationMs: 12000,
    maximumUnitDurationMs: 35000,
    maximumBufferCharacters: 900,
    maximumChunksPerUnit: 5,
    recoveryMaximumChunksPerUnit: 2,
    recoveryMinimumUnitDurationMs: 8000,
    shortTranscriptCharacters: 18,
    weakVadRatio: 0.12,
    weakNoSpeechProbability: 0.38,
    weakAverageLogProbability: -0.72
  });

  function normalize(value) { return pipeline.normalizeTranscript(value); }

  function evaluateShortTranscript(text, metadata, config = BUFFER_CONFIG) {
    const normalized = normalize(text);
    if (!normalized) return { accepted: false, reason: 'EMPTY_TRANSCRIPT' };
    if (normalized.length > config.shortTranscriptCharacters) return { accepted: true, reason: null };
    const vad = metadata && metadata.vad;
    const quality = metadata && metadata.transcriptionQuality;
    const weakVad = vad && vad.voicedRatio < config.weakVadRatio;
    const weakNoSpeech = quality && Number.isFinite(quality.maximumNoSpeechProbability)
      && quality.maximumNoSpeechProbability >= config.weakNoSpeechProbability;
    const weakLogProbability = quality && Number.isFinite(quality.minimumAverageLogProbability)
      && quality.minimumAverageLogProbability <= config.weakAverageLogProbability;
    const veryBriefEnergy = vad && vad.voicedDurationMs < 650;
    const weakSignals = [weakVad, weakNoSpeech, weakLogProbability, veryBriefEnergy].filter(Boolean).length;
    return weakSignals >= 2
      ? { accepted: false, reason: 'SHORT_TRANSCRIPT_WEAK_AUDIO' }
      : { accepted: true, reason: null };
  }

  function unitDurationMs(chunks) {
    if (!chunks.length) return 0;
    return Math.max(0, chunks[chunks.length - 1].endedAt - chunks[0].startedAt);
  }

  function liveLatencyMs(chunks, now) {
    if (!chunks.length) return 0;
    return Math.max(0, now - chunks[0].startedAt);
  }

  function mergedText(chunks) { return normalize(chunks.map(chunk => chunk.text).join(' ')); }

  function decideFlush(chunks, now = Date.now(), config = BUFFER_CONFIG) {
    if (!chunks.length) return { flush: false, reason: null, latencyMs: 0, durationMs: 0 };
    const text = mergedText(chunks);
    const durationMs = unitDurationMs(chunks);
    const latencyMs = liveLatencyMs(chunks, now);
    const completeThought = pipeline.hasSentenceEnding(text);
    let reason = null;
    if (latencyMs >= config.hardMaximumLatencyMs) reason = 'HARD_MAX_LATENCY';
    else if (text.length >= config.maximumBufferCharacters) reason = 'MAX_BUFFER_SIZE';
    else if (chunks.length >= config.maximumChunksPerUnit) reason = 'MAX_CHUNK_COUNT';
    else if (durationMs >= config.maximumUnitDurationMs) reason = 'MAX_UNIT_DURATION';
    else if (latencyMs >= config.softMaximumLatencyMs) reason = 'SOFT_MAX_LATENCY';
    else if (completeThought && durationMs >= config.minimumUnitDurationMs) reason = 'COMPLETE_THOUGHT';
    else if (completeThought && latencyMs >= config.targetLatencyMs) reason = 'TARGET_LATENCY_COMPLETE';
    return { flush: Boolean(reason), reason, latencyMs, durationMs, textLength: text.length, completeThought };
  }

  function createUnit(chunks, reason, now = Date.now()) {
    const first = chunks[0];
    const last = chunks[chunks.length - 1];
    return {
      sessionId: first.sessionId,
      sequenceNumber: first.sequenceNumber,
      timestamp: last.timestamp,
      startedAt: first.startedAt,
      endedAt: last.endedAt,
      transcript: mergedText(chunks),
      transcriptChunks: chunks.map(chunk => ({ sequenceNumber: chunk.sequenceNumber, text: chunk.text })),
      mergedChunkCount: chunks.length,
      bufferDurationMs: unitDurationMs(chunks),
      liveLatencyMs: liveLatencyMs(chunks, now),
      transcriptLatencyMs: Math.max(0, ...chunks.map(chunk => Number(chunk.transcriptLatencyMs) || 0)),
      flushReason: reason
    };
  }

  class KhutbahBuffer {
    constructor({ config = {}, now = () => Date.now(), onFlush = async () => {}, onLifecycle = () => {} } = {}) {
      this.config = { ...BUFFER_CONFIG, ...config };
      this.now = now;
      this.onFlush = onFlush;
      this.onLifecycle = onLifecycle;
      this.chunks = [];
      this.timer = null;
      this.queue = Promise.resolve();
      this.recoveryMode = false;
    }

    add(chunk) {
      this.chunks.push(chunk);
      this.onLifecycle('BUFFER_ADD', { sessionId: chunk.sessionId, sequenceNumber: chunk.sequenceNumber, timestamp: this.now(), bufferSize: this.chunks.length });
      const effectiveConfig = this.recoveryMode ? {
        ...this.config,
        maximumChunksPerUnit: this.config.recoveryMaximumChunksPerUnit,
        minimumUnitDurationMs: this.config.recoveryMinimumUnitDurationMs,
        targetLatencyMs: Math.min(this.config.targetLatencyMs, 15000)
      } : this.config;
      const decision = decideFlush(this.chunks, this.now(), effectiveConfig);
      if (decision.flush) return this.flush(decision.reason);
      this.schedule();
      return Promise.resolve(null);
    }

    schedule() {
      clearTimeout(this.timer);
      if (!this.chunks.length) return;
      const delay = Math.max(0, this.config.softMaximumLatencyMs - liveLatencyMs(this.chunks, this.now()));
      this.timer = setTimeout(() => this.flush('SOFT_MAX_TIMER'), delay);
    }

    flush(reason = 'MANUAL_FLUSH') {
      clearTimeout(this.timer);
      this.timer = null;
      if (!this.chunks.length) return Promise.resolve(null);
      const chunks = this.chunks.splice(0);
      const unit = createUnit(chunks, reason, this.now());
      this.onLifecycle('BUFFER_FLUSH', { sessionId: unit.sessionId, sequenceNumber: unit.sequenceNumber, timestamp: this.now(), bufferSize: chunks.length, mergedChunkCount: unit.mergedChunkCount, flushReason: reason, translationLagMs: unit.liveLatencyMs });
      this.recoveryMode = unit.liveLatencyMs >= this.config.softMaximumLatencyMs
        ? true
        : (unit.liveLatencyMs <= this.config.targetLatencyMs ? false : this.recoveryMode);
      this.queue = this.queue.then(() => this.onFlush(unit));
      return this.queue.then(() => unit);
    }

    pause() { return this.flush('PAUSE_FLUSH'); }
    stop() { clearTimeout(this.timer); this.timer = null; this.chunks = []; }
    get pendingChunkCount() { return this.chunks.length; }
  }

  return Object.freeze({ BUFFER_CONFIG, evaluateShortTranscript, decideFlush, createUnit, KhutbahBuffer });
});
