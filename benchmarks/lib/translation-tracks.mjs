export function buildTranslationTracks(fixture, sttResults, configurations = ['current', 'candidate_a', 'candidate_b', 'candidate_c']) {
  const tracks = [];
  if (fixture.humanVerified && fixture.referenceTranscript) {
    for (const configuration of configurations) tracks.push({ fixtureId: fixture.id, track: 'reference_transcript', configuration, sourceText: fixture.referenceTranscript, sourceSttConfiguration: null, status: 'ready' });
  } else {
    for (const configuration of configurations) tracks.push({ fixtureId: fixture.id, track: 'reference_transcript', configuration, sourceText: null, sourceSttConfiguration: null, status: 'not_run', reason: 'MISSING_HUMAN_VERIFIED_TRANSCRIPT' });
  }
  for (const stt of sttResults || []) {
    for (const configuration of configurations) tracks.push({ fixtureId: fixture.id, track: 'stt_output', configuration, sourceText: stt.text || null, sourceSttConfiguration: stt.configuration, status: stt.accepted && stt.text ? 'ready' : 'not_run', reason: stt.accepted && stt.text ? null : 'NO_ACCEPTED_STT_OUTPUT' });
  }
  return tracks;
}
