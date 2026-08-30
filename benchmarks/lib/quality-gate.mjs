export function normalize(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function distance(left, right) {
  const a = Array.from(left); const b = Array.from(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

export function errorRate(reference, hypothesis, unit = 'word') {
  const ref = unit === 'character' ? Array.from(normalize(reference).replace(/\s/g, '')) : normalize(reference).split(' ').filter(Boolean);
  const hyp = unit === 'character' ? Array.from(normalize(hypothesis).replace(/\s/g, '')) : normalize(hypothesis).split(' ').filter(Boolean);
  return ref.length ? distance(ref, hyp) / ref.length : (hyp.length ? 1 : 0);
}

export function textMetrics(text) {
  const normalized = String(text || '').trim();
  const words = normalize(normalized).split(' ').filter(Boolean);
  const emDashCount = (normalized.match(/—/g) || []).length;
  const dashCount = (normalized.match(/[–—]/g) || []).length;
  const sentences = normalized.split(/(?<=[.!?])\s+|\n+/u).map(sentence => sentence.trim()).filter(Boolean);
  const sentenceWordCounts = sentences.map(sentence => normalize(sentence).split(' ').filter(Boolean).length);
  const maxSentenceWordCount = sentenceWordCounts.length ? Math.max(...sentenceWordCounts) : 0;
  const longSentenceCount = sentenceWordCounts.filter(count => count > 28).length;
  const clauseMarkers = /\b(?:dat|die|waarvan|waardoor|terwijl|wanneer|omdat|hoewel|zodat|doordat|hetgeen|want)\b|,/giu;
  const nestedClauseRisk = sentences.filter(sentence => (sentence.match(clauseMarkers) || []).length >= 3).length;
  const translationesePatterns = [
    /\bdaaruit voortvloei\w*\b/iu, /\bvoordelige gevolgen van uit\b/iu, /\btot aan de genoemde\b/iu,
    /\bde voortreffelijkheid van\b/iu, /\bverheven zij zijn vermelding\b/iu, /\bhet doen herleven van\b/iu,
    /\bverstomming\b/iu, /\bglans en luister van het gevoel\b/iu, /\b(?:inderdaad|waarlijk)\b/giu
  ];
  const translationeseSignals = translationesePatterns.flatMap(pattern => normalized.match(pattern) || []);
  const unclearReferencePatterns = [/\bervan\b/giu, /\bdaaruit\b/giu, /\bhetgeen\b/giu, /^\s*het\b/iu, /\bhet staat tussen\b/iu, /\bhet wekt hem\b/iu];
  const unclearReferenceSignals = unclearReferencePatterns.flatMap(pattern => normalized.match(pattern) || []);
  const literalHonorificPattern = /(?:Allah\s*[—–-]\s*verheven zij Zijn vermelding|Ibn al-Qayyim\s*[—–-]\s*Allah zij barmhartig voor hem)/iu;
  const awkwardPatterns = [/\bwaarschuwer\b/i, /\buitnodiging naar (?:hem|allah)\b/i, /\buit zijn verderf\b/i, /\bsjiet(?:an|aan)\b/i, /\bsjeitan\b/i]
    .filter(pattern => pattern.test(normalized)).map(pattern => pattern.source);
  return {
    wordCount: words.length, dashCount, dashPer100Words: words.length ? (dashCount / words.length) * 100 : 0,
    emDashCount, emDashPer100Words: words.length ? (emDashCount / words.length) * 100 : 0,
    longSentenceCount, maxSentenceWordCount, nestedClauseRisk,
    translationeseSignalCount: translationeseSignals.length,
    unclearReferenceSignalCount: unclearReferenceSignals.length,
    literalHonorificSignalCount: literalHonorificPattern.test(normalized) ? 1 : 0,
    readabilityWarnings: [
      ...(emDashCount ? ['em_dash'] : []), ...(longSentenceCount ? ['long_sentence'] : []),
      ...(nestedClauseRisk ? ['nested_clause_risk'] : []), ...(translationeseSignals.length ? ['translationese'] : []),
      ...(unclearReferenceSignals.length ? ['unclear_reference'] : []), ...(literalHonorificPattern.test(normalized) ? ['literal_honorific'] : [])
    ], awkwardPatterns
  };
}

const META_OUTPUT = /\b(?:i cannot|i can't|the passage appears|possible transcription error|as an ai|linguistic analysis|please verify)\b/i;
export function hardFailures({ output = '', expectedDecision, observedDecision, sequenceNumbers = [] } = {}) {
  const failures = [];
  if (/Allah\s*ﷺ/u.test(output)) failures.push('WRONG_ALLAH_HONORIFIC');
  if (/Allah\s*عليه السلام/u.test(output)) failures.push('WRONG_ALLAH_HONORIFIC');
  if (/(?:Profeet\s+Muhammad|de Profeet)\s*ﷻ/iu.test(output)) failures.push('WRONG_PROPHET_HONORIFIC');
  if (META_OUTPUT.test(output)) failures.push('META_OUTPUT');
  if (expectedDecision === 'reject' && observedDecision === 'accept') failures.push('SILENCE_HALLUCINATION_STORED');
  if (sequenceNumbers.some((value, index) => index && value <= sequenceNumbers[index - 1])) failures.push('SEQUENCE_ORDER_CORRUPTION');
  return failures;
}

export function scoreFixture(fixture, configuration = 'current') {
  const output = fixture.candidateOutputs?.[configuration] || '';
  const metrics = textMetrics(output);
  const hasReferenceTranscript = fixture.verificationStatus === 'human_verified' && fixture.expectedTranscript && fixture.observedTranscript;
  const stt = hasReferenceTranscript ? { wer: errorRate(fixture.expectedTranscript, fixture.observedTranscript, 'word'), cer: errorRate(fixture.expectedTranscript, fixture.observedTranscript, 'character') } : { wer: null, cer: null, reason: 'requires human_verified transcript' };
  const terminologyHits = (fixture.importantReligiousTerms || []).filter(term => normalize(output).includes(normalize(term))).length;
  const terminology = fixture.importantReligiousTerms?.length ? Math.round((terminologyHits / fixture.importantReligiousTerms.length) * 10) : null;
  const failures = hardFailures({ output, sequenceNumbers: fixture.sequenceNumbers || [] });
  const presentationSuitability = output ? Math.max(0, 10 - Math.min(6, Math.round(metrics.dashPer100Words)) - metrics.awkwardPatterns.length * 2) : null;
  return {
    id: fixture.id, split: fixture.split, category: fixture.category, languageProfile: fixture.languageProfile,
    verificationStatus: fixture.verificationStatus, configuration, transcript: fixture.observedTranscript || null, output,
    scores: { stt: stt.wer === null ? null : Math.max(0, Math.round((1 - Math.min(1, stt.wer)) * 10)), meaningFidelity: null, dutchNaturalness: null, religiousIntegrity: failures.length ? 0 : null, completeness: null, terminology, presentationSuitability },
    automaticMetrics: { ...stt, ...metrics }, hardFailures: failures,
    humanReviewRequired: ['meaningFidelity', 'dutchNaturalness', 'religiousIntegrity', 'completeness'], notes: fixture.notes
  };
}

export const QUALITY_THRESHOLDS = Object.freeze({ hardReligiousOrSafetyFailures: 0, metaOutputFailures: 0, sequenceIntegrityPercent: 100, silenceFixtureRejectPercent: 100, meaningFidelityHumanAverage: 8, dutchNaturalnessHumanAverage: 8, firstReadComprehensionHumanAverage: 8.5, firstReadComprehensionSeriousCaseReviewBelow: 7, religiousIntegrityHumanMinimum: 9, emDashPer100WordsTarget: 0, emDashPer100WordsReviewAbove: 0, emDashPer100WordsPresentationFailureCandidateAbove: 2 });

export function latencyBudget(latency = {}) {
  const components = { audioCaptureMs: latency.audioCaptureMs || 0, transcriptionQueueWaitMs: latency.transcriptionQueueWaitMs || 0, whisperLatencyMs: latency.whisperLatencyMs || 0, bufferWaitMs: latency.bufferWaitMs || 0, translationQueueWaitMs: latency.translationQueueWaitMs || 0, translationLatencyMs: latency.translationLatencyMs || 0, readingQueueWaitMs: latency.readingQueueWaitMs || 0 };
  const totalUserVisibleLagMs = Object.values(components).reduce((sum, value) => sum + value, 0);
  const largestContributor = Object.entries(components).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { components, totalUserVisibleLagMs, largestContributor };
}
