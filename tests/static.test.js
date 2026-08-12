const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const dynamicIds = new Set(['processing-entry']);
const references = new Set([...app.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]));
const missingIds = [...references].filter(id => !ids.has(id) && !dynamicIds.has(id));
assert.deepEqual(missingIds, [], `missing DOM ids: ${missingIds.join(', ')}`);

const handlers = [...html.matchAll(/onclick="([A-Za-z_$][\w$]*)\(/g)].map(match => match[1]);
const missingHandlers = [...new Set(handlers)].filter(name => !new RegExp(`function\\s+${name}\\s*\\(`).test(app));
assert.deepEqual(missingHandlers, [], `missing handlers: ${missingHandlers.join(', ')}`);

const expectedOrder = ['translations.js', 'pipeline.js', 'audio.js', 'boot.js', 'app.js'];
const positions = expectedOrder.map(file => html.indexOf(`src="${file}"`));
assert.ok(positions.every(position => position >= 0));
assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'scripts must load in dependency order');

console.log('static integration tests passed');
