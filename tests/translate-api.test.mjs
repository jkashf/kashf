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

console.log('translation API tests passed');
