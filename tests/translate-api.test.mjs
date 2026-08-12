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
assert.match(translate.SYSTEM_PROMPT, /taqwa, dhikr, sunnah, fitrah en tawakkul/);
assert.match(translate.SYSTEM_PROMPT, /Profeet Mohammed ﷺ.*alleen wanneer de identiteit/s);
assert.match(translate.SYSTEM_PROMPT, /andere zeker geïdentificeerde profeet.*عليه السلام/s);
assert.match(translate.SYSTEM_PROMPT, /onduidelijke naam.*nooit.*gok/s);
assert.match(translate.SYSTEM_PROMPT, /geen religieuze status/);
assert.match(translate.SYSTEM_PROMPT, /nooit om ontbrekende audio aan te vullen/);

const dutchStyleMessage = translate.buildUserMessage({ text: 'لا يستطيع العقل أن يتصور', sourceLanguage: 'ar', targetLanguage: 'nl', context: {} });
assert.match(dutchStyleMessage, /goede menselijke livetolk/);
assert.match(dutchStyleMessage, /verdrietigheden/);
assert.match(dutchStyleMessage, /het verstand is niet in staat/);
assert.match(dutchStyleMessage, /normaal, helder en volwassen Nederlands/);

const firstTermMessage = translate.buildUserMessage({
  text: 'ومن ثمرات التقوى', sourceLanguage: 'ar', targetLanguage: 'nl',
  context: { recentOriginals: [], recentTranslations: [], introducedIslamicTerms: [] }
});
assert.match(firstTermMessage, /REEDS GEÏNTRODUCEERDE TERMEN[\s\S]*\(geen\)/);
assert.ok(firstTermMessage.endsWith('ومن ثمرات التقوى'), 'Arabic source must remain the direct new passage');

const followupTermMessage = translate.buildUserMessage({
  text: 'والتقوى هنا', sourceLanguage: 'ar', targetLanguage: 'nl',
  context: { recentOriginals: ['التقوى'], recentTranslations: ['Taqwa (bewust leven met ontzag voor Allah ﷺ)'], introducedIslamicTerms: ['taqwa'] }
});
assert.match(followupTermMessage, /REEDS GEÏNTRODUCEERDE TERMEN[\s\S]*taqwa/);
assert.ok(followupTermMessage.endsWith('والتقوى هنا'));

const longArabicPassage = 'ا'.repeat(600);
const longMessage = translate.buildUserMessage({ text: longArabicPassage, sourceLanguage: 'ar', targetLanguage: 'nl', context: {} });
assert.ok(longMessage.endsWith(longArabicPassage), 'long source passage must be preserved without client-side summarization');

console.log('translation API tests passed');
