import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreFixture, hardFailures, QUALITY_THRESHOLDS, latencyBudget } from './lib/quality-gate.mjs';
import { comparison, tenMinuteScenarios } from './lib/pacer-simulator.mjs';

const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url));
const dataset = JSON.parse(await fs.readFile(path.join(benchmarkRoot, 'datasets', 'technical-v1.json'), 'utf8'));
const configurations = JSON.parse(await fs.readFile(path.join(benchmarkRoot, 'configs', 'translation-configs.json'), 'utf8'));
const results = dataset.fixtures.map(fixture => scoreFixture(fixture, 'current'));
const detectorProbes = dataset.fixtures.filter(fixture => fixture.probeOutput).map(fixture => ({ id: fixture.id, expected: fixture.expectedHardFailures || [], detected: hardFailures({ output: fixture.probeOutput }) }));
const baselineLatency = latencyBudget({ audioCaptureMs: 8000, transcriptionQueueWaitMs: 0, whisperLatencyMs: 2000, bufferWaitMs: 20000, translationQueueWaitMs: 0, translationLatencyMs: 5000, readingQueueWaitMs: 0 });

const report = {
  qualityGateVersion: '1.0.0', generatedAt: new Date().toISOString(), datasetVersion: dataset.datasetVersion,
  limitations: ['No real audio fixtures are included.', 'No human_verified Arabic or Darija accuracy fixtures are included.', 'Meaning, naturalness, religious integrity and completeness remain human-reviewed.', 'No paid provider calls were made.'],
  fixtureCounts: { total: dataset.fixtures.length, synthetic: dataset.fixtures.filter(item => item.verificationStatus === 'synthetic').length, humanVerified: dataset.fixtures.filter(item => item.verificationStatus === 'human_verified').length },
  configurations, thresholds: QUALITY_THRESHOLDS, results, detectorProbes,
  detectorCoveragePassed: detectorProbes.every(probe => probe.expected.every(code => probe.detected.includes(code))),
  pacerComparison: comparison(), pacingScenarios: tenMinuteScenarios(245), baselineLatencyBudget: baselineLatency
};

const reportsDir = path.join(benchmarkRoot, 'reports');
await fs.mkdir(reportsDir, { recursive: true });
await fs.writeFile(path.join(reportsDir, 'current.json'), `${JSON.stringify(report, null, 2)}\n`);

const blindRows = dataset.fixtures.filter(item => Object.keys(item.candidateOutputs || {}).length).map((fixture, index) => {
  const labels = Object.entries(fixture.candidateOutputs).map(([, output], candidateIndex) => `<section><h4>Variant ${String.fromCharCode(65 + candidateIndex)}</h4><p>${escapeHtml(output || '(geen output)')}</p></section>`).join('');
  return `<article><h3>${escapeHtml(fixture.id)}</h3><p><b>Categorie:</b> ${escapeHtml(fixture.category)} · <b>Taalprofiel:</b> ${escapeHtml(fixture.languageProfile)} · <b>Status:</b> ${escapeHtml(fixture.verificationStatus)}</p><details><summary>Bron/transcript</summary><p>${escapeHtml(fixture.expectedTranscript || fixture.observedTranscript || '(niet beschikbaar)')}</p></details><div class="variants">${labels}</div><p>Menselijke scores: betekenis __/10 · natuurlijk Nederlands __/10 · religieuze zorgvuldigheid __/10 · volledigheid __/10 · voorkeur __</p></article>`;
}).join('\n');
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
const html = `<!doctype html><meta charset="utf-8"><title>Kashf blind review</title><style>body{font:16px system-ui;max-width:1000px;margin:auto;padding:32px;color:#222}article{border-top:1px solid #ccc;padding:24px 0}.variants{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.variants section{background:#f6f4ee;padding:16px;border-radius:10px}</style><h1>Kashf Quality Gate — blinde review</h1><p>Varianten zijn neutraal gelabeld. Synthetic fixtures bewijzen geen echte vertaalnauwkeurigheid.</p>${blindRows}`;
await fs.writeFile(path.join(reportsDir, 'blind-review.html'), html);
console.log(JSON.stringify({ fixtureCounts: report.fixtureCounts, detectorCoveragePassed: report.detectorCoveragePassed, baselineLatencyBudget: report.baselineLatencyBudget, reports: ['benchmarks/reports/current.json', 'benchmarks/reports/blind-review.html'] }, null, 2));
