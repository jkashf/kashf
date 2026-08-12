const TARGET_LANGUAGES = Object.freeze({
  nl: 'Nederlands', en: 'English', fr: 'français', de: 'Deutsch',
  es: 'español', ar_out: 'العربية'
});

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
  if (!process.env.ANTHROPIC_KEY) {
    console.error('[translate] ANTHROPIC_KEY is not configured');
    return sendError(res, 500, 'TRANSLATION_ERROR', 'Vertaling is tijdelijk niet beschikbaar.');
  }

  const body = parseBody(req.body);
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';
  const targetLanguage = body && typeof body.lang === 'string' ? body.lang : 'nl';
  const languageName = TARGET_LANGUAGES[targetLanguage];
  if (!text || !languageName || text.length > 12000) {
    return sendError(res, 400, 'INVALID_REQUEST', 'Ongeldige tekst of doeltaal.');
  }

  const systemPrompt = `Vertaal de aangeleverde gesproken tekst natuurlijk naar ${languageName}. Geef uitsluitend de vertaling, zonder uitleg of interpretatie. Voeg niets toe dat de spreker niet heeft gezegd.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }]
      })
    });

    if (!response.ok) {
      console.error('[translate] provider error', { status: response.status });
      const code = response.status >= 500 ? 'NETWORK_ERROR' : 'TRANSLATION_ERROR';
      return sendError(res, 502, code, 'Vertaling is tijdelijk niet beschikbaar.');
    }

    let data;
    try { data = await response.json(); } catch (error) {
      console.error('[translate] invalid provider response', { message: error.message });
      return sendError(res, 502, 'TRANSLATION_ERROR', 'Vertaling kon niet worden verwerkt.');
    }

    const translation = data.content && data.content[0] && typeof data.content[0].text === 'string'
      ? data.content[0].text.trim()
      : '';
    if (!translation) return sendError(res, 502, 'TRANSLATION_ERROR', 'Vertaling kon niet worden verwerkt.');
    return res.status(200).json({ translation });
  } catch (error) {
    console.error('[translate] request failed', { name: error.name, message: error.message });
    return sendError(res, 502, 'NETWORK_ERROR', 'Vertaalservice is niet bereikbaar.');
  }
}
