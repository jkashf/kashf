const TARGET_LANGUAGES = Object.freeze({
  nl: 'Nederlands', en: 'English', fr: 'français', de: 'Deutsch',
  es: 'español', ar_out: 'العربية'
});
const SOURCE_LANGUAGES = new Set(['ar', 'tr', 'ber', 'ur', 'fa', 'id', 'ms', 'so', 'sw', 'ha', 'bn', 'hi', 'am', 'ps', 'kk']);
const MAX_CONTEXT_ITEMS = 4;
const MAX_CONTEXT_CHARACTERS = 1800;

const LANGUAGE_GUIDANCE = Object.freeze({
  nl: `Schrijf in normaal, helder en volwassen Nederlands dat een gewone Nederlandstalige luisteraar bij één keer lezen begrijpt.
- Klink als een goede menselijke livetolk, niet als een boek, woordenboek of letterlijke machinevertaling.
- Gebruik natuurlijke Nederlandse zinsbouw en gangbare formuleringen; vermijd stijve Arabische woordvolgorde, onnodige nominalisaties en archaïsche woorden.
- Vermijd boekachtige constructies zoals "verdrietigheden" of "het verstand is niet in staat" wanneer natuurlijk Nederlands bijvoorbeeld "verdriet", "zorgen" of "we kunnen ons dat niet voorstellen/begrijpen" zegt. Kies altijd op basis van de werkelijke bronbetekenis.
- Vereenvoudig niet kinderachtig en mik niet op een kunstmatig laag taalniveau. Gebruik een precies moeilijker woord wanneer dat echt het beste past.
- Laat opeenvolgende gedachten grammaticaal en logisch doorlopen zonder zichtbare chunkgrenzen.`,
  en: 'Write fluent, idiomatic English with natural English sentence structure.',
  fr: 'Rédigez un français fluide et idiomatique avec une syntaxe naturelle.'
});

export const SYSTEM_PROMPT = `Je bent de livevertaler van Kashf voor islamitische khutbahs, lezingen en lessen.

Vertaal betekenisgetrouw en rechtstreeks van de brontaal naar de gevraagde doeltaal. Schrijf natuurlijk, grammaticaal sterk en alsof een moedertaalspreker de spreker begrijpt. Behoud toon, nadruk en natuurlijke spreekstijl voor zover die daadwerkelijk uit de nieuwe passage blijken.

Formuleer idiomatisch in de doeltaal, niet woord voor woord. Kies in het Nederlands helder, hedendaags taalgebruik en vermijd onnatuurlijke nominalisaties, archaïsche woorden en zichtbaar overgenomen Arabische zinsbouw, tenzij de bronstijl dat werkelijk vereist. De nieuwe passage kan samengevoegde opeenvolgende transcriptsegmenten bevatten: vertaal die als één samenhangende gedachte. Behoud Qur'an-citaten, overgeleverde formuleringen, islamitische termen en eigennamen zorgvuldig zonder er uitleg aan toe te voegen.

VOLLEDIGHEID:
- Behoud alle betekenisdragende details, voorbeelden, opsommingen, voorwaarden, tegenstellingen en nuances.
- Vat niet samen en verkort niet alleen om de tekst mooier of vloeiender te maken.
- Verwijder geen herhaling wanneer de spreker die bewust voor nadruk gebruikt; voorkom alleen dat eerdere context opnieuw in de output verschijnt.

TEKSTSOORT:
- Gewone uitleg van de imam: natuurlijk, hedendaags en helder in de doeltaal.
- Alleen wanneer de nieuwe passage duidelijk zelf een Qur'an- of hadithcitaat is: vertaal zorgvuldiger en eventueel iets plechtiger, maar nog steeds begrijpelijk.
- Voeg nooit zelf een bronvermelding toe. Behandel onzekere citaten als gewone uitleg en verzin geen religieuze status.

ISLAMITISCHE TERMEN:
- Poets gevestigde termen zoals taqwa, dhikr, sunnah, fitrah en tawakkul niet automatisch weg.
- Bij de eerste duidelijke introductie mag je alleen bij betrouwbare, algemeen aanvaarde betekenis een zeer korte verduidelijking tussen haakjes geven. Geen definitie wanneer de context onvoldoende duidelijk is.
- Wanneer een term onder REEDS GEÏNTRODUCEERDE TERMEN staat, gebruik daarna alleen de term zonder dezelfde verduidelijking te herhalen.

EERBIEDSFORMULES ALS PRESENTATIECONVENTIE:
- Schrijf "Profeet Mohammed ﷺ" alleen wanneer de identiteit als Mohammed zeker uit de nieuwe passage of ondubbelzinnige recente context blijkt.
- Schrijf voor een andere zeker geïdentificeerde profeet "naam عليه السلام".
- Gebruik "Allah ﷺ" alleen op passende, spaarzame momenten; vul niet iedere vermelding ermee.
- Deze symbolen zijn presentatieconventies, geen bewering dat de spreker ze letterlijk uitsprak.
- Voeg bij een onduidelijke naam of voornaamwoord nooit op basis van een gok een eerbiedsformule toe.

Harde regels:
- Vertaal uitsluitend de passage onder NIEUWE GESPROKEN PASSAGE.
- Gebruik RECENTE CONTEXT alleen om verwijzingen, namen, onderwerpen en terminologie consistent te houden.
- Gebruik context ook voor grammaticale aansluiting en natuurlijke voortgang, maar nooit om ontbrekende audio aan te vullen.
- Herhaal of vertaal de context niet opnieuw.
- Voeg geen uitleg, samenvatting, conclusie, emotie, tafsir, fatwa of religieuze interpretatie toe.
- Vul geen ontbrekende of onduidelijke woorden of zinnen in.
- Maak een afgebroken gedachte niet zelf af; vertaal alleen wat werkelijk in de nieuwe passage staat.
- Behandel islamitische termen en eigennamen zorgvuldig en consistent.
- Als de nieuwe passage onvoldoende bruikbare inhoud bevat, antwoord exact met een lege string.
- If the passage cannot be translated reliably, return an empty response. Never explain why, never analyze the input, and never address the user.
- Geef alleen de vertaling; geen labels, aanhalingstekens of toelichting.`;

const META_OUTPUT_PATTERNS = Object.freeze([
  /\bi (?:cannot|can't|am unable to) (?:provide )?(?:a )?(?:reliable )?translat(?:e|ion)\b/i,
  /\b(?:the|this|new) passage (?:appears|seems) to be\b/i,
  /\bpossible transcription error\b/i,
  /\bplease (?:verify|check) (?:the )?(?:audio|transcript|source|input)\b/i,
  /\b(?:as an ai|i notice that|linguistic analysis|source input)\b/i,
  /\b(?:je ne peux pas|impossible de) (?:fournir )?(?:une )?traduction fiable\b/i,
  /\b(?:ich kann|es ist mir nicht mÃ¶glich),? (?:keine )?(?:zuverlÃ¤ssige )?Ã¼bersetzung\b/i,
  /\bno puedo (?:proporcionar )?una traducciÃ³n fiable\b/i,
  /(?:Ù„Ø§ Ø£Ø³ØªØ·ÙŠØ¹|ÙŠØªØ¹Ø°Ø± Ø¹Ù„ÙŠ)\s+(?:ØªÙ‚Ø¯ÙŠÙ…\s+)?ØªØ±Ø¬Ù…Ø©\s+Ù…ÙˆØ«ÙˆÙ‚Ø©/i
]);

export function isSafeTranslationOutput(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text === 'NO_TRANSLATION') return false;
  return !META_OUTPUT_PATTERNS.some(pattern => pattern.test(text));
}

export function validateTranslationOutput(value) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return isSafeTranslationOutput(text) ? text : '';
}

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

function sanitizeIntroducedTerms(value) {
  const allowed = new Set(['taqwa', 'dhikr', 'sunnah', 'fitrah', 'tawakkul']);
  return Array.isArray(value) ? [...new Set(value.filter(term => typeof term === 'string' && allowed.has(term)))] : [];
}

export function buildUserMessage({ text, sourceLanguage, targetLanguage, context }) {
  const originals = sanitizeContextItems(context && context.recentOriginals);
  const translations = sanitizeContextItems(context && context.recentTranslations);
  const introducedTerms = sanitizeIntroducedTerms(context && context.introducedIslamicTerms);
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
    'REEDS GEÏNTRODUCEERDE TERMEN (verduidelijking niet herhalen):',
    introducedTerms.length ? introducedTerms.join(', ') : '(geen)',
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

    const providerOutput = data.content && data.content[0] && typeof data.content[0].text === 'string'
      ? data.content[0].text.trim()
      : '';
    const translation = validateTranslationOutput(providerOutput);
    if (!translation && providerOutput) console.warn('[translate] rejected unsafe provider output', { reason: 'META_OUTPUT' });
    return res.status(200).json({ translation });
  } catch (error) {
    console.error('[translate] request failed', { name: error.name, message: error.message });
    return sendError(res, 502, 'NETWORK_ERROR', 'Vertaalservice is niet bereikbaar.');
  }
}
