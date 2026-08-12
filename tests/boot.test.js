const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const classicScripts = ['translations.js', 'pipeline.js', 'khutbah-buffer.js', 'reading-pacer.js', 'audio.js', 'boot.js', 'app.js'];
const combinedSource = classicScripts.map(file => fs.readFileSync(file, 'utf8')).join('\n');
assert.doesNotThrow(() => new vm.Script(combinedSource), 'classic scripts must not have global lexical collisions');

const splash = { dataset: {}, style: {} };
const listeners = {};
const context = {
  console: { info() {}, warn() {}, error() {} },
  document: { getElementById(id) { return id === 'splash' ? splash : null; } },
  setTimeout(callback) { context.scheduled = callback; return 1; },
  addEventListener(type, callback) { listeners[type] = callback; },
  KashfI18n: { UI: {}, SPEECH_LANGS: {}, WHISPER_LANGS: {} },
  KashfPipeline: { filterTranscript() {} },
  KashfKhutbahBuffer: { KhutbahBuffer: function KhutbahBuffer() {} },
  KashfReadingPacer: { ReadingPacer: function ReadingPacer() {} },
  KashfAudioController: function KashfAudioController() {}
};
context.window = context;
vm.runInNewContext(fs.readFileSync('boot.js', 'utf8'), context);
assert.equal(context.KashfBoot.validateDependencies(), true);
assert.equal(typeof listeners.error, 'function');
listeners.error({ message: 'synthetic boot failure' });
assert.equal(splash.style.pointerEvents, 'none', 'runtime errors must make splash non-blocking');

delete context.KashfPipeline;
assert.equal(context.KashfBoot.validateDependencies(), false, 'missing dependency must fail validation');

console.log('boot tests passed');
