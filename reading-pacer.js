(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KashfReadingPacer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PACER_CONFIG = Object.freeze({
    wordsPerMinute: 210,
    breathingPauseMs: 0,
    minimumDisplayMs: 5000,
    maximumDisplayMs: 22000,
    targetMinimumWords: 30,
    targetMaximumWords: 55
  });

  function normalize(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
  function countWords(value) { const text = normalize(value); return text ? text.split(' ').length : 0; }

  function estimateReadingTimeMs(value, config = PACER_CONFIG) {
    const readingMs = (countWords(value) / config.wordsPerMinute) * 60000 + config.breathingPauseMs;
    return Math.round(Math.min(config.maximumDisplayMs, Math.max(config.minimumDisplayMs, readingMs)));
  }

  function sentenceUnits(value) {
    const text = normalize(value);
    if (!text) return [];
    const matches = text.match(/[^.!?؟]+(?:[.!?؟]+["'»”’)]*|$)/gu);
    return (matches || [text]).map(normalize).filter(Boolean);
  }

  function splitForReading(value, config = PACER_CONFIG) {
    const sentences = sentenceUnits(value);
    const passages = [];
    let current = '';
    for (const sentence of sentences) {
      const candidate = normalize([current, sentence].filter(Boolean).join(' '));
      if (current && countWords(candidate) > config.targetMaximumWords && countWords(current) >= config.targetMinimumWords) {
        passages.push(current);
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current) passages.push(current);
    return passages;
  }

  function createReadingPassages(unit, config = PACER_CONFIG) {
    const parts = splitForReading(unit.translation, config);
    return parts.map((translation, index) => ({
      id: `${unit.sessionId}:${unit.sequenceNumber}:${index}`,
      sessionId: unit.sessionId,
      sequenceNumber: unit.sequenceNumber,
      partNumber: index,
      partCount: parts.length,
      timestamp: unit.timestamp,
      translation,
      originalTranscript: unit.originalTranscript,
      estimatedReadingTimeMs: estimateReadingTimeMs(translation, config),
      sourcePassageMetadata: {
        audioStartedAt: unit.audioStartedAt,
        audioEndedAt: unit.audioEndedAt,
        mergedChunkCount: unit.mergedChunkCount,
        flushReason: unit.flushReason,
        translationLatencyMs: unit.translationLatencyMs,
        translationLagMs: unit.liveLatencyMs
      }
    }));
  }

  function calculateLag(queue, current, now = Date.now()) {
    const queued = Array.isArray(queue) ? queue : [];
    const waiting = [...(current ? [current] : []), ...queued];
    const oldestQueuedAudioStart = queued.map(item => item.sourcePassageMetadata.audioStartedAt).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const readingLagMs = queued.reduce((sum, item) => sum + item.estimatedReadingTimeMs, 0);
    const translationLagMs = waiting.reduce((maximum, item) => Math.max(maximum, Number(item.sourcePassageMetadata.translationLagMs) || 0), 0);
    const currentShownLag = current && Number.isFinite(current.shownAt) && Number.isFinite(current.sourcePassageMetadata.audioStartedAt)
      ? Math.max(0, current.shownAt - current.sourcePassageMetadata.audioStartedAt)
      : 0;
    return {
      translationLagMs,
      readingLagMs,
      totalUserLagMs: Number.isFinite(oldestQueuedAudioStart) ? Math.max(0, now - oldestQueuedAudioStart) : currentShownLag
    };
  }

  class ReadingPacer {
    constructor({ config = {}, now = () => Date.now(), onShow = () => {}, onState = () => {}, onLifecycle = () => {} } = {}) {
      this.config = { ...PACER_CONFIG, ...config };
      this.now = now;
      this.onShow = onShow;
      this.onState = onState;
      this.onLifecycle = onLifecycle;
      this.queue = [];
      this.current = null;
      this.shown = [];
      this.timer = null;
      this.remainingMs = 0;
      this.visibleStartedAt = null;
      this.minimumElapsed = false;
      this.paused = false;
    }

    enqueueUnit(unit) {
      const passages = createReadingPassages(unit, this.config);
      this.queue.push(...passages);
      this.onLifecycle('PACER_ENQUEUE', this.lifecycleMetadata(passages[0]));
      this.emitState();
      if (!this.current && !this.paused) this.showNext();
      else if (this.current && this.minimumElapsed && !this.paused) this.showNext();
      return passages;
    }

    showNext() {
      clearTimeout(this.timer);
      this.timer = null;
      if (this.paused) { this.emitState(); return null; }
      if (!this.queue.length) {
        this.current = null;
        this.remainingMs = 0;
        this.visibleStartedAt = null;
        this.onLifecycle('PACER_ADVANCE', this.lifecycleMetadata(null));
        this.emitState();
        return null;
      }
      this.current = this.queue.shift();
      this.current.shownAt = this.now();
      this.shown.push(this.current);
      this.visibleStartedAt = this.current.shownAt;
      this.remainingMs = this.current.estimatedReadingTimeMs;
      this.minimumElapsed = false;
      this.onShow(this.current);
      this.onLifecycle('PACER_SHOW', this.lifecycleMetadata(this.current));
      this.emitState();
      this.timer = setTimeout(() => {
        this.timer = null;
        this.remainingMs = 0;
        this.minimumElapsed = true;
        if (this.queue.length) {
          this.onLifecycle('PACER_ADVANCE', this.lifecycleMetadata(this.current));
          this.showNext();
        } else this.emitState();
      }, this.remainingMs);
      return this.current;
    }

    pause() {
      if (this.paused) return;
      this.paused = true;
      if (this.current && this.visibleStartedAt !== null) {
        this.remainingMs = Math.max(0, this.remainingMs - (this.now() - this.visibleStartedAt));
      }
      clearTimeout(this.timer);
      this.timer = null;
      this.emitState();
    }

    resume() {
      if (!this.paused) return;
      this.paused = false;
      if (this.current) {
        if (this.minimumElapsed) {
          if (this.queue.length) this.showNext();
          else this.emitState();
          return;
        }
        this.visibleStartedAt = this.now();
        this.timer = setTimeout(() => {
          this.timer = null;
          this.remainingMs = 0;
          this.minimumElapsed = true;
          if (this.queue.length) {
            this.onLifecycle('PACER_ADVANCE', this.lifecycleMetadata(this.current));
            this.showNext();
          } else this.emitState();
        }, Math.max(250, this.remainingMs));
      } else this.showNext();
      this.emitState();
    }

    stop() {
      clearTimeout(this.timer);
      this.timer = null;
      this.paused = true;
      this.emitState();
      return this.allInOrder();
    }

    allInOrder() {
      const byId = new Map([...this.shown, ...(this.current ? [this.current] : []), ...this.queue].map(item => [item.id, item]));
      return [...byId.values()].sort((a, b) => a.sequenceNumber - b.sequenceNumber || a.partNumber - b.partNumber);
    }

    metrics() { return calculateLag(this.queue, this.current, this.now()); }
    lifecycleMetadata(passage) {
      const metrics = this.metrics();
      return {
        sessionId: passage && passage.sessionId,
        sequenceNumber: passage && passage.sequenceNumber,
        timestamp: this.now(),
        queueLength: this.queue.length,
        currentPassageId: passage ? passage.id : null,
        estimatedDisplayMs: passage ? passage.estimatedReadingTimeMs : 0,
        timerRemainingMs: this.remainingMs,
        isPaused: this.paused,
        translationLagMs: metrics.translationLagMs,
        readingLagMs: metrics.readingLagMs,
        totalUserLagMs: metrics.totalUserLagMs
      };
    }
    emitState() { this.onState({ queueLength: this.queue.length, current: this.current, paused: this.paused, ...this.metrics() }); }
  }

  return Object.freeze({ PACER_CONFIG, countWords, estimateReadingTimeMs, sentenceUnits, splitForReading, createReadingPassages, calculateLag, ReadingPacer });
});
