export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    var key = process.env.ANTHROPIC_KEY || '';
    var body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
    var text = body.text || '';
    var lang = body.lang || 'nl';
    if (!text) { res.status(400).json({ error: 'Geen tekst', keyInfo: 'key length: ' + key.length + ', starts: ' + key.slice(0,8) }); return; }
    var systemPrompt = 'Vertaal naar Nederlands. Geef ALLEEN de vertaling. Geen uitleg.';
    if(lang==='en') systemPrompt = 'Translate to English. Give ONLY the translation.';
    if(lang==='fr') systemPrompt = 'Traduis en francais. Donne SEULEMENT la traduction.';
    if(lang==='de') systemPrompt = 'Uebersetze ins Deutsche. Gib NUR die Uebersetzung.';
    if(lang==='es') systemPrompt = 'Traduce al espanol. Da SOLO la traduccion.';
    if(lang==='ar_out') systemPrompt = 'ترجم للعربية. أعط الترجمة فقط.';
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: systemPrompt,
        messages: [{role: 'user', content: text}]
      })
    });
    var data = await response.json();
    if(!response.ok) { res.status(500).json({ error: JSON.stringify(data), keyLength: key.length, keyStart: key.slice(0,8) }); return; }
    var translation = data.content && data.content[0] ? data.content[0].text.trim() : '';
    res.status(200).json({ translation });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
