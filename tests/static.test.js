const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const styles = fs.readFileSync('styles.css', 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const dynamicIds = new Set(['processing-entry']);
const references = new Set([...app.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]));
const missingIds = [...references].filter(id => !ids.has(id) && !dynamicIds.has(id));
assert.deepEqual(missingIds, [], `missing DOM ids: ${missingIds.join(', ')}`);

const handlers = [...html.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map(match => match[1]);
const missingHandlers = [...new Set(handlers)].filter(name => !new RegExp(`function\\s+${name}\\s*\\(`).test(app));
assert.deepEqual(missingHandlers, [], `missing handlers: ${missingHandlers.join(', ')}`);

const expectedOrder = ['translations.js', 'pipeline.js', 'lifecycle.js', 'khutbah-buffer.js', 'reading-pacer.js', 'audio.js', 'boot.js', 'app.js'];
const positions = expectedOrder.map(file => html.search(new RegExp(`src="${file.replace('.', '\\.')}(?:\\?[^\"]+)?"`)));
assert.ok(positions.every(position => position >= 0));
assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'scripts must load in dependency order');

assert.match(app, /isKhutbahMode\(\).*session\.mode==='khutbah'/s, 'scroll behavior must be explicitly scoped to Khutbah mode');
assert.match(app, /if\(isKhutbahMode\(\)\)await khutbahBuffer\.add/, 'Khutbah must use buffered translation');
assert.match(app, /else await queueTranscriptForTranslation/, 'Lecture mode must preserve direct translation behavior');
assert.match(app, /session\.ended=true[\s\S]*setKhutbahScrollLock\(false\)/, 'stop must unlock the completed session');
assert.match(app, /if\(!session\.ended\)goBack\(\)/, 'closing the thanks modal must retain completed history for review');
assert.match(app, /download-btn'\)\.style\.display=enabled\?'none'/, 'active Khutbah must hide the read/export invitation');
assert.match(styles, /khutbah-scroll-locked\{[^}]*overflow-y:hidden/, 'active Khutbah scrolling must be blocked');
assert.match(html, /Kashf loopt bewust iets achter/);
assert.match(app, /readingPacer\.enqueueUnit\(passage\)/, 'translated units must enter the reading queue before display');
assert.match(app, /feed\.innerHTML='';[\s\S]*reading-current/, 'current reading passage must own a stable viewport');
assert.match(app, /readingPacer\.pause\(\)/);
assert.match(app, /readingPacer\.resume\(\)/);
assert.match(app, /readingPacer\.stop\(\)[\s\S]*renderFeed\(\)/, 'stop must expose normal full history');

console.log('static integration tests passed');
