export function visibilityMs(words, { wordsPerMinute, minimumDisplayMs = 5000, maximumDisplayMs = 22000 }) {
  return Math.round(Math.min(maximumDisplayMs, Math.max(minimumDisplayMs, (words / wordsPerMinute) * 60000)));
}

export function comparison({ speeds = [230, 245, 260, 275], wordCounts = [10, 20, 35, 50, 70, 90] } = {}) {
  return speeds.map(wordsPerMinute => ({
    wordsPerMinute,
    passages: wordCounts.map(words => ({ words, calculatedReadingMs: Math.round((words / wordsPerMinute) * 60000), actualMinimumVisibilityMs: visibilityMs(words, { wordsPerMinute }) }))
  }));
}

export function simulateScenario({ name, wordsPerPassage, arrivalIntervalsMs, translationDelaysMs, wordsPerMinute }) {
  let arrivalAt = 0; let displayAvailableAt = 0; let translationAvailableAt = 0;
  const passages = wordsPerPassage.map((words, index) => {
    if (index) arrivalAt += arrivalIntervalsMs[index % arrivalIntervalsMs.length];
    const translationStartedAt = Math.max(arrivalAt, translationAvailableAt);
    const translationDelay = translationDelaysMs[index % translationDelaysMs.length];
    const translationReadyAt = translationStartedAt + translationDelay;
    translationAvailableAt = translationReadyAt;
    const displayStartedAt = Math.max(translationReadyAt, displayAvailableAt);
    const visiblePassageDurationMs = visibilityMs(words, { wordsPerMinute });
    displayAvailableAt = displayStartedAt + visiblePassageDurationMs;
    return {
      sequenceNumber: index, words, arrivalAt, translationQueueWaitMs: translationStartedAt - arrivalAt,
      translationLatencyMs: translationDelay, readingQueueWaitMs: displayStartedAt - translationReadyAt,
      totalLagMs: displayStartedAt - arrivalAt, visiblePassageDurationMs
    };
  });
  const maximum = field => Math.max(...passages.map(item => item[field]));
  const average = field => Math.round(passages.reduce((sum, item) => sum + item[field], 0) / passages.length);
  return { name, wordsPerMinute, passageCount: passages.length, durationMs: arrivalAt, summary: {
    maxTranslationQueueWaitMs: maximum('translationQueueWaitMs'), maxReadingQueueWaitMs: maximum('readingQueueWaitMs'), maxTotalLagMs: maximum('totalLagMs'),
    averageTranslationQueueWaitMs: average('translationQueueWaitMs'), averageReadingQueueWaitMs: average('readingQueueWaitMs'), averageTotalLagMs: average('totalLagMs')
  }, passages };
}

export function tenMinuteScenarios(wordsPerMinute = 245) {
  const count = 30;
  const words = Array.from({ length: count }, (_, index) => [20, 35, 50, 70, 35][index % 5]);
  return [
    simulateScenario({ name: 'translation_faster_than_reader', wordsPerPassage: words, arrivalIntervalsMs: [20000], translationDelaysMs: [3500], wordsPerMinute }),
    simulateScenario({ name: 'reader_faster_than_translation', wordsPerPassage: words, arrivalIntervalsMs: [20000], translationDelaysMs: [23000], wordsPerMinute }),
    simulateScenario({ name: 'temporary_translation_burst', wordsPerPassage: words, arrivalIntervalsMs: [20000, 20000, 7000, 7000, 7000, 39000], translationDelaysMs: [4000], wordsPerMinute }),
    simulateScenario({ name: 'one_30_second_translation_then_recovery', wordsPerPassage: words, arrivalIntervalsMs: [20000], translationDelaysMs: [4000, 4000, 4000, 4000, 30000, 4000, 4000, 4000], wordsPerMinute })
  ];
}
