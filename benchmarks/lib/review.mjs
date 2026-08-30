function hash(value) { let result = 2166136261; for (const character of String(value)) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619); } return result >>> 0; }
function random(seed) { let state = hash(seed); return () => ((state = Math.imul(1664525, state) + 1013904223 >>> 0) / 4294967296); }

export function blindVariants(outputs, seed, fixtureId) {
  const rng = random(`${seed}:${fixtureId}`);
  const shuffled = Object.entries(outputs || {}).map(([configuration, output]) => ({ configuration, output }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) { const target = Math.floor(rng() * (index + 1)); [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]; }
  return shuffled.map((item, index) => ({ label: `Variant ${String.fromCharCode(65 + index)}`, ...item }));
}

export function serializeReview({ fixtureId, reviewerId, variantScores, preferredVariant, flags = [], notes = '' }) {
  return { schemaVersion: '1.0', fixtureId, reviewerId, reviewedAt: new Date().toISOString(), variantScores, preferredVariant, flags, notes };
}

export function aggregateReviews(reviews) {
  const byFixture = new Map();
  for (const review of reviews) { if (!byFixture.has(review.fixtureId)) byFixture.set(review.fixtureId, []); byFixture.get(review.fixtureId).push(review); }
  return [...byFixture.entries()].map(([fixtureId, fixtureReviews]) => {
    const preferences = fixtureReviews.map(item => item.preferredVariant);
    const scoreValues = fixtureReviews.flatMap(item => Object.values(item.variantScores || {}).flatMap(scores => Object.values(scores).filter(Number.isFinite)));
    return { fixtureId, reviewerCount: fixtureReviews.length, averageScore: scoreValues.length ? scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length : null, scoreRange: scoreValues.length ? Math.max(...scoreValues) - Math.min(...scoreValues) : null, preferredVariantAgreement: new Set(preferences).size <= 1, preferredVariants: preferences, requiresSecondReviewer: fixtureReviews.length < 2 };
  });
}

export const REVIEW_FLAGS = Object.freeze(['meaning_lost', 'meaning_added', 'awkward_dutch', 'religious_concern', 'quran_concern', 'hadith_concern', 'terminology', 'punctuation', 'other']);
