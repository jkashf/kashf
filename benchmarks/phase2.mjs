import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeManifest, fixtureStatus, segmentPlan } from './lib/real-audio.mjs';
import { STT_CONFIGS, requestPlan, assertLiveOptIn } from './lib/stt-adapters.mjs';
import { buildTranslationTracks } from './lib/translation-tracks.mjs';
import { blindVariants, aggregateReviews } from './lib/review.mjs';
import { analyzeLifecycle } from './lib/lifecycle-analyzer.mjs';
import { compareLifecyclePacing } from './lib/pacer-simulator.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const command = process.argv[2] || 'dry-run';
const manifest = JSON.parse(await fs.readFile(path.join(root, 'datasets', 'real-audio-core-v1.json'), 'utf8'));
const fixtures = materializeManifest(manifest);
const audioRoot = path.join(root, 'fixtures', 'audio');
const statuses = await Promise.all(fixtures.map(item => fixtureStatus(item, audioRoot)));
const translationConfigurations = ['current', 'candidate_a', 'candidate_b'];
const plan = requestPlan(statuses, Object.keys(STT_CONFIGS), translationConfigurations);

if (command === 'live-plan') {
  console.log(JSON.stringify({ liveCallsExecuted: false, ...plan, note: 'Run is still blocked. Re-run with live execution tooling and --confirm-live only after reviewing this plan.' }, null, 2));
  process.exit(0);
}
if (command === 'assert-live-opt-in') {
  assertLiveOptIn(process.argv.slice(3));
  console.log(JSON.stringify({ optInAccepted: true, ...plan }, null, 2));
  process.exit(0);
}
if (command === 'summarize-reviews') {
  const reviewDir = path.join(root, 'reviews', 'local');
  const files = (await fs.readdir(reviewDir)).filter(name => name.endsWith('.json'));
  const reviews = await Promise.all(files.map(name => fs.readFile(path.join(reviewDir, name), 'utf8').then(JSON.parse)));
  console.log(JSON.stringify(aggregateReviews(reviews), null, 2));
  process.exit(0);
}
if (command !== 'dry-run') throw new Error('UNKNOWN_PHASE2_COMMAND');

const lifecycleFixture = JSON.parse(await fs.readFile(path.join(root, 'datasets', 'lifecycle-dry-run.json'), 'utf8'));
const lifecycleAnalysis = analyzeLifecycle(lifecycleFixture);
const pacingComparison = compareLifecyclePacing(lifecycleFixture);
const translationTracks = fixtures.slice(0, 1).flatMap(fixture => buildTranslationTracks(fixture, [], translationConfigurations));
const seed = 'kashf-quality-gate-v2';
const blindPreview = blindVariants({ current: '', candidate_a: '', candidate_b: '' }, seed, fixtures[0].id);
const report = {
  phase: 2, mode: 'dry_run', generatedAt: new Date().toISOString(), liveApiCallsExecuted: false,
  supportedAudioFormats: ['mp3', 'm4a', 'wav', 'webm'], fixtureCounts: { total: fixtures.length, ready: statuses.filter(item => item.status === 'ready').length, notRun: statuses.filter(item => item.status === 'not_run').length, rejected: statuses.filter(item => item.status === 'rejected').length },
  statuses, sttConfigurations: STT_CONFIGS, requestPlan: plan, translationTracks, blindReview: { seed, preview: blindPreview },
  lifecycleAnalysis, pacingComparison, exampleSegmentPlan: segmentPlan(125, 20),
  claims: { realArabicAccuracy: 'not_run', realDarijaAccuracy: 'not_run', mixedLanguageAccuracy: 'not_run', preferredTranslationCandidate: 'not_run' }
};
await fs.mkdir(path.join(root, 'reports'), { recursive: true });
await fs.writeFile(path.join(root, 'reports', 'phase2-dry-run.json'), `${JSON.stringify(report, null, 2)}\n`);
const reviewTemplate = { schemaVersion: '1.0', fixtureId: 'replace-with-fixture-id', reviewerId: 'local-reviewer-id', reviewedAt: null, variantScores: { 'Variant A': { meaningFidelity: null, dutchNaturalness: null, religiousIntegrity: null, completeness: null, liveReadability: null }, 'Variant B': { meaningFidelity: null, dutchNaturalness: null, religiousIntegrity: null, completeness: null, liveReadability: null }, 'Variant C': { meaningFidelity: null, dutchNaturalness: null, religiousIntegrity: null, completeness: null, liveReadability: null } }, preferredVariant: 'tie', flags: [], notes: '' };
await fs.writeFile(path.join(root, 'reports', 'review-template.json'), `${JSON.stringify(reviewTemplate, null, 2)}\n`);
const blindHtml = `<!doctype html><meta charset="utf-8"><title>Kashf Fase 2 blind review</title><style>body{font:16px system-ui;max-width:1000px;margin:auto;padding:32px}.variants{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}section{background:#f5f2e9;padding:16px}</style><h1>Kashf real-audio blind review</h1><p>Seed: ${seed}. Zichtbare variantvolgorde is reproduceerbaar. Er zijn nog geen human-verified fixtures; onderstaande workflow is daarom not_run.</p><h2>Benodigde reviewvelden</h2><p>Meaning fidelity · Dutch naturalness · Religious integrity · Completeness · Live readability (1–10)</p><p>Voorkeur: A / B / C / tie</p><p>Flags: meaning lost · meaning added · awkward Dutch · religious concern · Qur'an concern · hadith concern · terminology · punctuation · other</p>`;
await fs.writeFile(path.join(root, 'reports', 'phase2-blind-review.html'), blindHtml);
console.log(JSON.stringify({ mode: report.mode, liveApiCallsExecuted: false, fixtureCounts: report.fixtureCounts, requestPlan: plan, claims: report.claims, reports: ['benchmarks/reports/phase2-dry-run.json', 'benchmarks/reports/review-template.json', 'benchmarks/reports/phase2-blind-review.html'] }, null, 2));
