import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await fs.readFile(new URL('../api/translate.js', import.meta.url), 'utf8');
const translate = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
process.env.ANTHROPIC_KEY = 'test-only';

function responseRecorder() {
  return {
    statusCode: 200, body: undefined, headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
}

for (const targetLanguage of ['nl', 'en', 'fr']) {
  let providerPayload;
  globalThis.fetch = async (_url, options) => {
    providerPayload = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ content: [{ text: 'translation' }] }) };
  };
  const res = responseRecorder();
  await translate.default({ method: 'POST', body: {
    text: 'هذا هو النص الجديد', sourceLanguage: 'ar', targetLanguage,
    context: { recentOriginals: ['سياق سابق'], recentTranslations: ['previous context'] }
  } }, res);
  assert.equal(res.statusCode, 200);
  const message = providerPayload.messages[0].content;
  assert.match(message, new RegExp(`DOELTAAL: ${targetLanguage}`));
  assert.match(message, /NIEUWE GESPROKEN PASSAGE/);
  assert.ok(message.endsWith('هذا هو النص الجديد'));
  assert.match(providerPayload.system, /Vertaal uitsluitend de passage/);
}

assert.match(translate.SYSTEM_PROMPT, /Vat niet samen/);
assert.match(translate.SYSTEM_PROMPT, /Behoud alle betekenisdragende details/);
assert.match(translate.SYSTEM_PROMPT, /Gewone uitleg van de imam: natuurlijk, hedendaags en helder/);
assert.match(translate.SYSTEM_PROMPT, /duidelijk zelf een Qur'an- of hadithcitaat/);
assert.match(translate.SYSTEM_PROMPT, /Voeg nooit zelf een bronvermelding toe/);
assert.match(translate.SYSTEM_PROMPT, /taqwa, dhikr, sunnah, fitrah, tawakkul en shaytan/);
assert.match(translate.SYSTEM_PROMPT, /Profeet Mohammed ﷺ.*alleen wanneer de identiteit/s);
assert.match(translate.SYSTEM_PROMPT, /Allah ﷻ.*passende, spaarzame momenten/s);
assert.doesNotMatch(translate.SYSTEM_PROMPT, /Allah ﷺ/);
assert.match(translate.SYSTEM_PROMPT, /andere zeker geïdentificeerde profeet.*عليه السلام/s);
assert.match(translate.SYSTEM_PROMPT, /onduidelijke naam.*nooit.*gok/s);
assert.match(translate.SYSTEM_PROMPT, /geen religieuze status/);
assert.match(translate.SYSTEM_PROMPT, /nooit om ontbrekende audio aan te vullen/);

const dutchStyleMessage = translate.buildUserMessage({ text: 'لا يستطيع العقل أن يتصور', sourceLanguage: 'ar', targetLanguage: 'nl', context: {} });
assert.match(dutchStyleMessage, /goede menselijke livetolk/);
assert.match(dutchStyleMessage, /verdrietigheden/);
assert.match(dutchStyleMessage, /het verstand is niet in staat/);
assert.match(dutchStyleMessage, /normaal, helder en volwassen Nederlands/);
assert.match(dutchStyleMessage, /consequent "shaytan"/);
assert.match(dutchStyleMessage, /Vermijd boekachtige of dramatische gedachtestreepjes/);

const firstTermMessage = translate.buildUserMessage({
  text: 'ومن ثمرات التقوى', sourceLanguage: 'ar', targetLanguage: 'nl',
  context: { recentOriginals: [], recentTranslations: [], introducedIslamicTerms: [] }
});
assert.match(firstTermMessage, /REEDS GEÏNTRODUCEERDE TERMEN[\s\S]*\(geen\)/);
assert.ok(firstTermMessage.endsWith('ومن ثمرات التقوى'), 'Arabic source must remain the direct new passage');

const followupTermMessage = translate.buildUserMessage({
  text: 'والتقوى هنا', sourceLanguage: 'ar', targetLanguage: 'nl',
  context: { recentOriginals: ['التقوى'], recentTranslations: ['Taqwa (bewust leven met ontzag voor Allah ﷻ)'], introducedIslamicTerms: ['taqwa'] }
});
assert.match(followupTermMessage, /REEDS GEÏNTRODUCEERDE TERMEN[\s\S]*taqwa/);
assert.ok(followupTermMessage.endsWith('والتقوى هنا'));

const longArabicPassage = 'ا'.repeat(600);
const longMessage = translate.buildUserMessage({ text: longArabicPassage, sourceLanguage: 'ar', targetLanguage: 'nl', context: {} });
assert.ok(longMessage.endsWith(longArabicPassage), 'long source passage must be preserved without client-side summarization');

assert.equal(translate.isSafeTranslationOutput('De imam benadrukt dat dankbaarheid het hart tot rust brengt.'), true, 'valid translations must remain');
assert.equal(translate.isSafeTranslationOutput('I cannot provide a reliable translation of this passage.'), false, 'explicit refusal meta-output must be rejected');
assert.equal(translate.isSafeTranslationOutput('I notice that the new passage appears to be a fragmentary phrase with a possible transcription error. Please verify the audio.'), false, 'analysis-style meta-output must be rejected');
assert.equal(translate.isSafeTranslationOutput('Deze vertaling benadrukt het belang van oprechtheid.'), true, 'a normal sentence containing translation must not be rejected by one generic word');
assert.equal(translate.validateTranslationOutput('NO_TRANSLATION'), '');
assert.match(translate.SYSTEM_PROMPT, /If the passage cannot be translated reliably, return an empty response/);
assert.match(translate.SYSTEM_PROMPT, /Never explain why, never analyze the input, and never address the user/);

for (const unsafeOutput of [
  'I cannot translate this reliably.',
  'The passage appears to be corrupted and may contain a possible transcription error.'
]) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ text: unsafeOutput }] }) });
  const rejected = responseRecorder();
  await translate.default({ method: 'POST', body: { text: 'Ù†Øµ Ø¹Ø±Ø¨ÙŠ', sourceLanguage: 'ar', targetLanguage: 'nl' } }, rejected);
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.body.translation, '', 'unsafe provider output must become an empty successful response');
}

console.log('translation API tests passed');
