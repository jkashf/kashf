(function (root) {
  const REQUIRED_DEPENDENCIES = Object.freeze([
    ['KashfI18n', value => value && value.UI && value.SPEECH_LANGS && value.WHISPER_LANGS],
    ['KashfPipeline', value => value && typeof value.filterTranscript === 'function'],
    ['KashfLifecycle', value => value && typeof value.log === 'function'],
    ['KashfKhutbahBuffer', value => value && typeof value.KhutbahBuffer === 'function'],
    ['KashfReadingPacer', value => value && typeof value.ReadingPacer === 'function'],
    ['KashfAudioController', value => typeof value === 'function']
  ]);

  function hideSplash(reason) {
    const splash = document.getElementById('splash');
    if (!splash || splash.dataset.dismissed === 'true') return;
    splash.dataset.dismissed = 'true';
    splash.style.opacity = '0';
    splash.style.pointerEvents = 'none';
    root.setTimeout(() => { splash.style.display = 'none'; }, 350);
    if (reason) console.warn('[Kashf boot] Splash fail-safe activated:', reason);
  }

  function validateDependencies() {
    const missing = REQUIRED_DEPENDENCIES
      .filter(([name, validate]) => !validate(root[name]))
      .map(([name]) => name);
    if (missing.length) {
      console.error('[Kashf boot] Missing or invalid frontend dependencies:', missing.join(', '));
      hideSplash('dependency validation failed');
      return false;
    }
    console.info('[Kashf boot] Frontend dependencies loaded successfully.');
    return true;
  }

  root.addEventListener('error', event => {
    console.error('[Kashf boot] Unhandled frontend error:', event.message || 'Unknown error');
    hideSplash('unhandled frontend error');
  });
  root.addEventListener('unhandledrejection', event => {
    const message = event.reason instanceof Error ? event.reason.message : 'Unhandled promise rejection';
    console.error('[Kashf boot] Unhandled promise rejection:', message);
    hideSplash('unhandled promise rejection');
  });

  root.KashfBoot = Object.freeze({ hideSplash, validateDependencies });
  validateDependencies();
  root.setTimeout(() => hideSplash('startup timeout'), 5000);
})(window);
