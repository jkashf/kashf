export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  try {
    var body = req.body || {};
    if (typeof body === 'string') try { body = JSON.parse(body); } catch(e) { body = {}; }
    var audioBase64 = body.audio || '';
    var srcLang = body.srcLang || 'ar';
    if (!audioBase64) { res.status(400).json({ error: 'Geen audio' }); return; }
    var audioBuffer = Buffer.from(audioBase64, 'base64');
    var boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    var CRLF = '\r\n';
    var before = Buffer.from('--' + boundary + CRLF + 'Content-Disposition: form-data; name="file"; filename="audio.webm"' + CRLF + 'Content-Type: audio/webm' + CRLF + CRLF);
    var after = Buffer.from(CRLF + '--' + boundary + CRLF + 'Content-Disposition: form-data; name="model"' + CRLF + CRLF + 'whisper-1' + CRLF + '--' + boundary + CRLF + 'Content-Disposition: form-data; name="language"' + CRLF + CRLF + (srcLang === 'tr' ? 'tr' : 'ar') + CRLF + '--' + boundary + CRLF + 'Content-Disposition: form-data; name="response_format"' + CRLF + CRLF + 'text' + CRLF + '--' + boundary + '--' + CRLF);
    var formData = Buffer.concat([before, audioBuffer, after]);
    var response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': formData.length},
      body: formData
    });
    if (!response.ok) { var err = await response.text(); res.status(500).json({ error: 'Whisper: ' + err.slice(0,200) }); return; }
    var text = await response.text();
    res.status(200).json({ text: text.trim() });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
