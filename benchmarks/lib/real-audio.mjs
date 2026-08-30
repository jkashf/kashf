import fs from 'node:fs/promises';
import path from 'node:path';

export const AUDIO_FORMATS = Object.freeze(['.mp3', '.m4a', '.wav', '.webm']);

export function materializeManifest(manifest) {
  return (manifest.fixtures || []).map(item => ({ ...manifest.defaults, ...item, provenance: { ...(manifest.defaults?.provenance || {}), ...(item.provenance || {}) } }));
}

export function validateFixture(fixture, audioRoot) {
  const errors = [];
  const extension = fixture.file ? path.extname(fixture.file).toLowerCase() : null;
  if (fixture.file && !AUDIO_FORMATS.includes(extension)) errors.push('UNSUPPORTED_AUDIO_FORMAT');
  if (!['ar', 'darija', 'mixed_ar_darija', 'quran_ar', 'hadith_ar'].includes(fixture.languageProfile)) errors.push('INVALID_LANGUAGE_PROFILE');
  for (const segment of fixture.expectedLanguageSwitches || []) {
    if (!(segment.startMs >= 0 && segment.endMs > segment.startMs)) errors.push('INVALID_LANGUAGE_SWITCH');
  }
  if (fixture.file && !fixture.provenance?.allowedForLocalBenchmark) errors.push('FORBIDDEN_BY_PERMISSION');
  const resolvedFile = fixture.file ? path.resolve(audioRoot, fixture.file) : null;
  return { valid: errors.length === 0, errors, resolvedFile };
}

export async function fixtureStatus(fixture, audioRoot) {
  const validation = validateFixture(fixture, audioRoot);
  if (!validation.valid) return { id: fixture.id, status: 'rejected', reasons: validation.errors };
  if (!fixture.file) return { id: fixture.id, status: 'not_run', reason: 'MISSING_AUDIO_FIXTURE' };
  try { await fs.access(validation.resolvedFile); } catch { return { id: fixture.id, status: 'not_run', reason: 'MISSING_AUDIO_FILE' }; }
  if (!fixture.humanVerified || !fixture.referenceTranscript) return { id: fixture.id, status: 'not_run', reason: 'MISSING_HUMAN_VERIFICATION' };
  return { id: fixture.id, status: 'ready', file: validation.resolvedFile };
}

export function segmentPlan(durationSeconds, segmentSeconds = 20) {
  const result = [];
  for (let start = 0, index = 0; start < durationSeconds; start += segmentSeconds, index += 1) result.push({ index, startSeconds: start, durationSeconds: Math.min(segmentSeconds, durationSeconds - start) });
  return result;
}
