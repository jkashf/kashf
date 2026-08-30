export const STT_CONFIGS = Object.freeze({
  current_stt: { label: 'CURRENT_STT', model: 'whisper-1', language: 'ar', responseFormat: 'verbose_json', timestampGranularities: ['segment'], metadataMode: 'whisper_segments' },
  whisper_auto: { label: 'WHISPER_AUTO', model: 'whisper-1', language: null, responseFormat: 'verbose_json', timestampGranularities: ['segment'], metadataMode: 'whisper_segments' },
  gpt4o_mini_transcribe: { label: 'GPT4O_MINI_TRANSCRIBE', model: 'gpt-4o-mini-transcribe', language: null, responseFormat: 'json', include: ['logprobs'], metadataMode: 'token_logprobs' },
  gpt4o_transcribe: { label: 'GPT4O_TRANSCRIBE', model: 'gpt-4o-transcribe', language: null, responseFormat: 'json', include: ['logprobs'], metadataMode: 'token_logprobs' }
});

function acceptWhisperSegment(segment) {
  if (!String(segment.text || '').trim()) return false;
  if (Number.isFinite(segment.no_speech_prob) && segment.no_speech_prob >= .72) return false;
  if (Number.isFinite(segment.avg_logprob) && segment.avg_logprob <= -1 && Number.isFinite(segment.no_speech_prob) && segment.no_speech_prob >= .45) return false;
  if (Number.isFinite(segment.compression_ratio) && segment.compression_ratio >= 2.4) return false;
  return true;
}

export function normalizeSttResult({ configuration, response = {}, latencyMs = null, accepted = true, rejectionReason = null, requestCount = 1, audioDurationSeconds = null }) {
  const config = STT_CONFIGS[configuration];
  if (!config) throw new Error('UNKNOWN_STT_CONFIGURATION');
  const rawWhisperSegments = config.metadataMode === 'whisper_segments' && Array.isArray(response.segments) ? response.segments : [];
  const acceptedWhisperSegments = rawWhisperSegments.filter(acceptWhisperSegment);
  const whisperSegments = acceptedWhisperSegments.map(segment => ({ startMs: Number.isFinite(segment.start) ? segment.start * 1000 : null, endMs: Number.isFinite(segment.end) ? segment.end * 1000 : null, text: segment.text || '', noSpeechProbability: Number.isFinite(segment.no_speech_prob) ? segment.no_speech_prob : null, averageLogProbability: Number.isFinite(segment.avg_logprob) ? segment.avg_logprob : null, compressionRatio: Number.isFinite(segment.compression_ratio) ? segment.compression_ratio : null }));
  const filteredText = rawWhisperSegments.length ? acceptedWhisperSegments.map(segment => String(segment.text || '').trim()).filter(Boolean).join(' ') : (typeof response.text === 'string' ? response.text.trim() : '');
  const finalAccepted = config.metadataMode === 'whisper_segments' ? Boolean(filteredText) && Boolean(accepted) : Boolean(accepted);
  return {
    configuration, model: config.model, text: config.metadataMode === 'whisper_segments' ? filteredText : (typeof response.text === 'string' ? response.text.trim() : ''), segments: whisperSegments,
    detectedLanguage: response.language || null, latencyMs, accepted: finalAccepted, rejectionReason: finalAccepted ? rejectionReason : (rejectionReason || 'NO_SPEECH_METADATA'),
    providerMetadata: { metadataMode: config.metadataMode, logprobsAvailable: Array.isArray(response.logprobs), usage: response.usage || null },
    cost: { audioDurationSeconds, requestCount, usage: response.usage || null, estimatedCost: null }
  };
}

export function requestPlan(fixtures, sttConfigurations = Object.keys(STT_CONFIGS), translationConfigurations = []) {
  const runnable = fixtures.filter(item => item.status === 'ready').length;
  return { runnableFixtures: runnable, sttConfigurations: sttConfigurations.length, translationConfigurations: translationConfigurations.length, estimatedSttRequests: runnable * sttConfigurations.length, estimatedTranslationRequests: runnable * sttConfigurations.length * translationConfigurations.length };
}

export function assertLiveOptIn(args = []) {
  if (!args.includes('--confirm-live')) throw new Error('LIVE_PROVIDER_CALLS_REQUIRE_EXPLICIT_CONFIRMATION');
  return true;
}

export async function runSttAdapter({ configuration, fileBytes, filename, mimeType, apiKey, confirmed = false, fetchImpl = fetch }) {
  if (!confirmed) throw new Error('LIVE_PROVIDER_CALLS_REQUIRE_EXPLICIT_CONFIRMATION');
  if (!apiKey) throw new Error('OPENAI_API_KEY_REQUIRED');
  const config = STT_CONFIGS[configuration];
  if (!config) throw new Error('UNKNOWN_STT_CONFIGURATION');
  const form = new FormData();
  form.append('file', new Blob([fileBytes], { type: mimeType }), filename);
  form.append('model', config.model);
  form.append('response_format', config.responseFormat);
  if (config.language) form.append('language', config.language);
  for (const granularity of config.timestampGranularities || []) form.append('timestamp_granularities[]', granularity);
  for (const include of config.include || []) form.append('include[]', include);
  const startedAt = Date.now();
  const response = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  if (!response.ok) throw new Error(`STT_PROVIDER_ERROR_${response.status}`);
  const providerResponse = await response.json();
  return normalizeSttResult({ configuration, response: providerResponse, latencyMs: Date.now() - startedAt });
}
