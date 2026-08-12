const TARGET_LANGUAGES = Object.freeze({
  nl: 'Nederlands', en: 'English', fr: 'français', de: 'Deutsch',
  es: 'español', ar_out: 'العربية'
});
const SOURCE_LANGUAGES = new Set(['ar', 'tr', 'ber', 'ur', 'fa', 'id', 'ms', 'so', 'sw', 'ha', 'bn', 'hi', 'am', 'ps', 'kk']);
const MAX_CONTEXT_ITEMS = 4;
const MAX_CONTEXT_CHARACTERS = 1800;

const LANGUAGE_GUIDANCE = Object.freeze({
  nl: 'Schrijf vloeiend, hedendaags Nederlands met natuurlijke Nederlandse zinsbouw.',
  en: 'Write fluent, idiomatic English with natural English sentence structure.',
  fr: 'Rédigez un français fluide et idiomatique avec une syntaxe naturelle.'
});

const SYSTEM_PROMPT = `Je bent de livevertaler van Kashf voor islamitische khutbahs, lezingen en lessen.

Vertaal betekenisgetrouw en rechtstreeks van de brontaal naar de gevraagde doeltaal. Schrijf natuurlijk, grammaticaal sterk en alsof een moedertaalspreker de spreker begrijpt. Behoud toon, nadruk en natuurlijke spreekstijl voor zover die daadwerkelijk uit de nieuwe passage blijken.

Harde regels:
- Vertaal uitsluitend de passage onder NIEUWE GESPROKEN PASSAGE.
- Gebruik RECENTE CONTEXT alleen om verwijzingen, namen, onderwerpen en terminologie consistent te houden.
- Herhaal of vertaal de context niet opnieuw.
- Voeg geen uitleg, samenvatting, conclusie, emotie, tafsir, fatwa of religieuze interpretatie toe.
- Vul geen ontbrekende of onduidelijke woorden of zinnen in.
- Behandel islamitische termen en eigennamen zorgvuldig en consistent.
- Als de nieuwe passage onvoldoende bruikbare inhoud bevat, antwoord exact met een lege string.
- Geef alleen de vertaling; geen labels, aanhalingstekens of toelichting.`;

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function parseBody(body) {
  if (typeof body !== 'string') return body || {};
  try { return JSON.parse(body); } catch (_) { return null; }
}

function sanitizeContextItems(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  let characters = 0;
  for (const item of value.slice(-MAX_CONTEXT_ITEMS)) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const remaining = MAX_CONTEXT_CHARACTERS - characters;
    if (remaining <= 0) break;
    result.push(text.slice(0, remaining));
    characters += Math.min(text.length, remaining);
  }
  return result;
}

function buildUserMessage({ text, sourceLanguage, targetLanguage, context }) {
  const originals = sanitizeContextItems(context && context.recentOriginals);
  const translations = sanitizeContextItems(context && context.recentTranslations);
  const guidance = LANGUAGE_GUIDANCE[targetLanguage] || `Schrijf natuurlijk en idiomatisch in ${TARGET_LANGUAGES[targetLanguage]}.`;
  return [
    `BRONTAAL: ${sourceLanguage}`,
    `DOELTAAL: ${targetLanguage} (${TARGET_LANGUAGES[targetLanguage]})`,
    `TAALINSTRUCTIE: ${guidance}`,
    '',
    'RECENTE ORIGINELE CONTEXT (niet opnieuw vertalen):',
    originals.length ? originals.map((item, index) => `${index + 1}. ${item}`).join('\n') : '(geen)',
    '',
    'RECENTE VERTALINGEN (alleen voor consistentie):',
    translations.length ? translations.map((item, index) => `${index + 1}. ${item}`).join('\n') : '(geen)',
    '',
    'NIEUWE GESPROKEN PASSAGE (vertaal alleen dit):',
    text
  ].join('\n');
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
  const targetLanguage = body && typeof (body.targetLanguage || body.lang) === 'string' ? (body.targetLanguage || body.lang) : 'nl';
  const sourceLanguage = body && typeof body.sourceLanguage === 'string' ? body.sourceLanguage : 'ar';
  const languageName = TARGET_LANGUAGES[targetLanguage];
  if (!text || !languageName || !SOURCE_LANGUAGES.has(sourceLanguage) || text.length > 12000) {
    return sendError(res, 400, 'INVALID_REQUEST', 'Ongeldige tekst of doeltaal.');
  }

  const userMessage = buildUserMessage({ text, sourceLanguage, targetLanguage, context: body.context });

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
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
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
    return res.status(200).json({ translation });
  } catch (error) {
    console.error('[translate] request failed', { name: error.name, message: error.message });
    return sendError(res, 502, 'NETWORK_ERROR', 'Vertaalservice is niet bereikbaar.');
  }
}
