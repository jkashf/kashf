export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

const TRANSCRIPTION_LANGUAGES = Object.freeze({
  ar: 'ar',
  tr: 'tr',
  ber: null,
  ur: 'ur',
  fa: 'fa',
  id: 'id',
  ms: 'ms',
  so: 'so',
  sw: 'sw',
  ha: 'ha',
  bn: 'bn',
  hi: 'hi',
  am: 'am',
  ps: 'ps',
  kk: 'kk'
});
export const TRANSCRIPT_FILTER_CONFIG = Object.freeze({
  maximumNoSpeechProbability: 0.72,
  minimumAverageLogProbability: -1.0,
  maximumCompressionRatio: 2.4
});

function isDevelopment() {
  return process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production';
}

function logRejection(reason, details = {}) {
  if (isDevelopment()) console.info('[whisper] transcript rejected', { reason, ...details });
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function evaluateSegment(segment, config = TRANSCRIPT_FILTER_CONFIG) {
  const text = segment && typeof segment.text === 'string' ? segment.text.trim() : '';
  const noSpeechProbability = numberOrNull(segment && segment.no_speech_prob);
  const averageLogProbability = numberOrNull(segment && segment.avg_logprob);
  const compressionRatio = numberOrNull(segment && segment.compression_ratio);
  if (!text) return { accepted: false, reason: 'empty_segment', text: '' };
  if (noSpeechProbability !== null && noSpeechProbability >= config.maximumNoSpeechProbability) {
    return { accepted: false, reason: 'no_speech_metadata', text };
  }
  if (averageLogProbability !== null
    && averageLogProbability <= config.minimumAverageLogProbability
    && noSpeechProbability !== null
    && noSpeechProbability >= 0.45) {
    return { accepted: false, reason: 'low_log_probability', text };
  }
  if (compressionRatio !== null && compressionRatio >= config.maximumCompressionRatio) {
    return { accepted: false, reason: 'high_compression_ratio', text };
  }
  return { accepted: true, reason: null, text };
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try { return JSON.parse(body); } catch (_) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendError(res, 405, 'INVALID_REQUEST', 'Deze methode wordt niet ondersteund.');
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('[whisper] OPENAI_API_KEY is not configured');
    return sendError(res, 500, 'TRANSCRIPTION_ERROR', 'Transcriptie is tijdelijk niet beschikbaar.');
  }

  const body = parseBody(req.body);
  const audioBase64 = body && typeof body.audio === 'string' ? body.audio.trim() : '';
  const sourceLanguage = body && typeof body.srcLang === 'string' ? body.srcLang : 'ar';
  const mimeType = body && typeof body.mimeType === 'string' ? body.mimeType : 'audio/webm';
  const hasSourceLanguage = Object.prototype.hasOwnProperty.call(TRANSCRIPTION_LANGUAGES, sourceLanguage);
  const transcriptionLanguage = TRANSCRIPTION_LANGUAGES[sourceLanguage];

  if (!audioBase64 || !hasSourceLanguage) {
    return sendError(res, 400, 'INVALID_REQUEST', 'Ongeldige audio of brontaal.');
  }
  if (!/^audio\/(webm|mp4|mpeg|mp3|m4a|wav|ogg)(;.*)?$/i.test(mimeType)) {
    return sendError(res, 400, 'INVALID_REQUEST', 'Niet-ondersteund audioformaat.');
  }

  let audioBuffer;
  try { audioBuffer = Buffer.from(audioBase64, 'base64'); } catch (_) { audioBuffer = null; }
  if (!audioBuffer || audioBuffer.length < 1000) {
    return sendError(res, 422, 'NO_SPEECH', 'Geen spraak gedetecteerd.');
  }

  const extension = ({
    'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
    'audio/m4a': 'm4a', 'audio/wav': 'wav', 'audio/ogg': 'ogg'
  })[mimeType.split(';')[0].toLowerCase()] || 'webm';
  const boundary = `----KashfFormBoundary${Math.random().toString(36).slice(2)}`;
  const crlf = '\r\n';
  const before = Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="audio.${extension}"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`);
  const languageField = transcriptionLanguage
    ? `--${boundary}${crlf}Content-Disposition: form-data; name="language"${crlf}${crlf}${transcriptionLanguage}${crlf}`
    : '';
  const responseFormatField = `--${boundary}${crlf}Content-Disposition: form-data; name="response_format"${crlf}${crlf}verbose_json${crlf}`;
  const timestampField = `--${boundary}${crlf}Content-Disposition: form-data; name="timestamp_granularities[]"${crlf}${crlf}segment${crlf}`;
  const after = Buffer.from(`${crlf}--${boundary}${crlf}Content-Disposition: form-data; name="model"${crlf}${crlf}whisper-1${crlf}${responseFormatField}${timestampField}${languageField}--${boundary}--${crlf}`);

  try {
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: Buffer.concat([before, audioBuffer, after])
    });

    if (!response.ok) {
      console.error('[whisper] provider error', { status: response.status });
      const code = response.status >= 500 ? 'NETWORK_ERROR' : 'TRANSCRIPTION_ERROR';
      return sendError(res, 502, code, 'Transcriptie is tijdelijk niet beschikbaar.');
    }

    let data;
    try { data = await response.json(); } catch (error) {
      console.error('[whisper] invalid provider response', { message: error.message });
      return sendError(res, 502, 'TRANSCRIPTION_ERROR', 'Transcriptie kon niet worden verwerkt.');
    }

    const segments = Array.isArray(data.segments) ? data.segments : [];
    const acceptedSegments = segments.map(segment => {
      const result = evaluateSegment(segment);
      if (!result.accepted) logRejection(result.reason, {
        noSpeechProbability: numberOrNull(segment.no_speech_prob),
        averageLogProbability: numberOrNull(segment.avg_logprob),
        compressionRatio: numberOrNull(segment.compression_ratio)
      });
      return result;
    }).filter(result => result.accepted);
    const text = segments.length
      ? acceptedSegments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim()
      : (typeof data.text === 'string' ? data.text.trim() : '');
    if (!text) return sendError(res, 422, 'NO_SPEECH', 'Geen spraak gedetecteerd.');
    return res.status(200).json({ text, segmentCount: acceptedSegments.length });
  } catch (error) {
    console.error('[whisper] request failed', { name: error.name, message: error.message });
    return sendError(res, 502, 'NETWORK_ERROR', 'Transcriptieservice is niet bereikbaar.');
  }
}
