export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    var body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
    var text = body.text || '';
    var lang = body.lang || 'nl';
    var prev = body.prev || '';
    if (!text) { res.status(400).json({ error: 'Geen tekst' }); return; }
    var langNames = {nl:'Nederlands',en:'English',fr:'francais',de:'Deutsch',es:'espanol',ar_out:'arabisch'};
    var systemPrompt = 'Vertaal naar ' + (langNames[lang]||'Nederlands') + '. Geef ALLEEN de vertaling. Geen uitleg. Als Profeet Mohammed wordt genoemd voeg vrede zij met hem toe.' + (prev ? ' Vorige zin: "' + prev + '".' : '');
    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01'},
      body: JSON.stringify({model: 'claude-haiku-4-5-20251001', max_tokens: 400, system: systemPrompt, messages: [{role: 'user', content: text}]})
    });
    var data = await response.json();
    var translation = data.content && data.content[0] ? data.content[0].text.trim() : '';
    res.status(200).json({ translation });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
