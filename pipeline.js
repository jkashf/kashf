(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.KashfPipeline = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const VAD_CONFIG = Object.freeze({
    sampleIntervalMs: 50,
    rmsThreshold: 0.018,
    peakThreshold: 0.055,
    minimumVoicedFrames: 6,
    minimumVoicedDurationMs: 300,
    minimumVoicedRatio: 0.08,
    minimumChunkDurationMs: 900
  });

  const CONTEXT_CONFIG = Object.freeze({
    maximumPassages: 4,
    maximumOriginalCharacters: 1800,
    maximumTranslationCharacters: 1800
  });

  const HALLUCINATION_PATTERNS = Object.freeze([
    /^thank you for watching[.!]?$/i,
    /^thanks for watching[.!]?$/i,
    /^subscribe( to (my|the) channel)?[.!]?$/i,
    /^subtitles? (by|made by|provided by)\b/i,
    /^amara\.org community$/i,
    /^\[(music|applause|silence|noise)\]$/i,
    /^\((music|applause|silence|noise)\)$/i
  ]);

  function decideVad(stats, config = VAD_CONFIG) {
    const durationMs = Math.max(0, Number(stats && stats.durationMs) || 0);
    const totalFrames = Math.max(0, Number(stats && stats.totalFrames) || 0);
    const voicedFrames = Math.max(0, Number(stats && stats.voicedFrames) || 0);
    const voicedDurationMs = voicedFrames * config.sampleIntervalMs;
    const voicedRatio = totalFrames ? voicedFrames / totalFrames : 0;
    const maximumRms = Math.max(0, Number(stats && stats.maximumRms) || 0);
    const maximumPeak = Math.max(0, Number(stats && stats.maximumPeak) || 0);
    const hasEnergy = maximumRms >= config.rmsThreshold || maximumPeak >= config.peakThreshold;
    const isSpeech = durationMs >= config.minimumChunkDurationMs
      && hasEnergy
      && voicedFrames >= config.minimumVoicedFrames
      && voicedDurationMs >= config.minimumVoicedDurationMs
      && voicedRatio >= config.minimumVoicedRatio;
    return { isSpeech, durationMs, totalFrames, voicedFrames, voicedDurationMs, voicedRatio, maximumRms, maximumPeak };
  }

  function normalizeTranscript(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function transcriptFingerprint(value) {
    return normalizeTranscript(value).toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, '').replace(/\s+/g, ' ').trim();
  }

  function isDuplicateTranscript(current, previous) {
    const currentFingerprint = transcriptFingerprint(current);
    const previousFingerprint = transcriptFingerprint(previous);
    return Boolean(currentFingerprint && previousFingerprint && currentFingerprint === previousFingerprint);
  }

  function isKnownHallucination(value) {
    const transcript = normalizeTranscript(value);
    return Boolean(transcript && HALLUCINATION_PATTERNS.some(pattern => pattern.test(transcript)));
  }

  function filterTranscript(value, previousValue) {
    const text = normalizeTranscript(value);
    if (!text) return { accepted: false, code: 'NO_SPEECH', text: '' };
    if (isDuplicateTranscript(text, previousValue)) return { accepted: false, code: 'DUPLICATE_TRANSCRIPT', text };
    if (isKnownHallucination(text)) return { accepted: false, code: 'LIKELY_HALLUCINATION', text };
    return { accepted: true, code: null, text };
  }

  function takeRecentWithinLimit(values, maximumCharacters) {
    const selected = [];
    let used = 0;
    for (let index = values.length - 1; index >= 0; index -= 1) {
      const value = normalizeTranscript(values[index]);
      if (!value) continue;
      const remaining = maximumCharacters - used;
      if (remaining <= 0) break;
      selected.unshift(value.length <= remaining ? value : value.slice(value.length - remaining));
      used += Math.min(value.length, remaining);
    }
    return selected;
  }

  function buildContext(passages, config = CONTEXT_CONFIG) {
    const recent = (Array.isArray(passages) ? passages : []).slice(-config.maximumPassages);
    return {
      recentOriginals: takeRecentWithinLimit(recent.map(item => item.originalTranscript), config.maximumOriginalCharacters),
      recentTranslations: takeRecentWithinLimit(recent.map(item => item.translation), config.maximumTranslationCharacters)
    };
  }

  function buildTranslationPayload({ transcript, sourceLanguage, targetLanguage, passages }) {
    const newTranscript = normalizeTranscript(transcript);
    return {
      text: newTranscript,
      sourceLanguage,
      targetLanguage,
      lang: targetLanguage,
      context: buildContext(passages)
    };
  }

  function insertPassageInOrder(passages, passage) {
    const withoutSameSequence = (Array.isArray(passages) ? passages : []).filter(item => item.sequenceNumber !== passage.sequenceNumber);
    return withoutSameSequence.concat(passage).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }

  function isCurrentSession(activeSessionId, resultSessionId) {
    return Boolean(activeSessionId && resultSessionId && activeSessionId === resultSessionId);
  }

  return Object.freeze({
    VAD_CONFIG,
    CONTEXT_CONFIG,
    HALLUCINATION_PATTERNS,
    decideVad,
    normalizeTranscript,
    transcriptFingerprint,
    isDuplicateTranscript,
    isKnownHallucination,
    filterTranscript,
    buildContext,
    buildTranslationPayload,
    insertPassageInOrder,
    isCurrentSession
  });
});
