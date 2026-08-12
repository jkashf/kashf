(function () {
  const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  class KashfAudioController {
    constructor({ speechLanguages, chunkDuration = 8000, minimumBytes = 8000 } = {}) {
      this.speechLanguages = speechLanguages || {};
      this.chunkDuration = chunkDuration;
      this.minimumBytes = minimumBytes;
      this.active = false;
      this.recorder = null;
      this.stream = null;
      this.timer = null;
      this.speechRecognition = null;
      this.pendingTranscript = '';
      this.pendingTimer = null;
      this.processingQueue = Promise.resolve();
      this.callbacks = {};
      this.sourceLanguage = 'ar';
    }

    get isActive() { return this.active; }

    async start(sourceLanguage, callbacks = {}) {
      this.stop();
      this.active = true;
      this.sourceLanguage = sourceLanguage || 'ar';
      this.callbacks = callbacks;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return this.startBrowserSpeech();
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!this.active) return this.stopStream();
        const mimeType = MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || '';
        this.createRecorder(mimeType);
        this.callbacks.onStatus?.('listening');
      } catch (error) {
        if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
          this.active = false;
          return this.callbacks.onError?.('MIC_PERMISSION_DENIED');
        }
        this.startBrowserSpeech();
      }
    }

    createRecorder(mimeType) {
      let chunks = [];
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
      this.recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      this.recorder.onstop = () => {
        const type = this.recorder?.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        chunks = [];
        if (blob.size >= this.minimumBytes) this.enqueueTranscription(blob);
      };
      this.recorder.start();
      this.timer = window.setInterval(() => {
        if (!this.active || !this.recorder || this.recorder.state !== 'recording') return;
        this.recorder.stop();
        window.setTimeout(() => {
          if (!this.active || !this.recorder || this.recorder.state !== 'inactive') return;
          try { this.recorder.start(); } catch (_) { this.callbacks.onError?.('TRANSCRIPTION_ERROR'); }
        }, 300);
      }, this.chunkDuration);
    }

    enqueueTranscription(blob) {
      this.processingQueue = this.processingQueue.then(() => this.transcribe(blob)).catch(error => console.error('[audio] queue failed', error));
    }

    async transcribe(blob) {
      if (!this.active) return;
      this.callbacks.onStatus?.('processing');
      try {
        const audio = await blobToBase64(blob);
        const response = await fetch('/api/whisper', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio, srcLang: this.sourceLanguage, mimeType: blob.type || 'audio/webm' })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const code = data.error && data.error.code ? data.error.code : 'TRANSCRIPTION_ERROR';
          if (code !== 'NO_SPEECH') this.callbacks.onError?.(code);
          return;
        }
        if (data.text && data.text.trim()) await this.callbacks.onTranscript?.(data.text.trim());
      } catch (error) {
        console.error('[audio] request failed', { name: error.name, message: error.message });
        this.callbacks.onError?.('NETWORK_ERROR');
      } finally {
        if (this.active) this.callbacks.onStatus?.('listening');
      }
    }

    startBrowserSpeech() {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { this.active = false; return this.callbacks.onError?.('TRANSCRIPTION_ERROR'); }
      const recognition = new SpeechRecognition();
      recognition.lang = this.speechLanguages[this.sourceLanguage] || 'ar-SA';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = event => {
        let interim = '', finalText = '';
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const text = event.results[index][0].transcript;
          if (event.results[index].isFinal) finalText += `${text} `; else interim += text;
        }
        if (interim) this.callbacks.onInterim?.(interim);
        if (finalText.trim()) {
          this.pendingTranscript += finalText;
          window.clearTimeout(this.pendingTimer);
          this.pendingTimer = window.setTimeout(() => {
            const text = this.pendingTranscript.trim();
            this.pendingTranscript = '';
            if (text) this.callbacks.onTranscript?.(text);
          }, 400);
        }
      };
      recognition.onerror = event => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          this.active = false;
          return this.callbacks.onError?.('MIC_PERMISSION_DENIED');
        }
        this.callbacks.onError?.('TRANSCRIPTION_ERROR');
      };
      recognition.onend = () => { if (this.active) try { recognition.start(); } catch (_) {} };
      this.speechRecognition = recognition;
      try { recognition.start(); this.callbacks.onStatus?.('listening'); }
      catch (_) { this.active = false; this.callbacks.onError?.('TRANSCRIPTION_ERROR'); }
    }

    pause() { this.stop(); }
    stopStream() { if (this.stream) this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
    stop() {
      this.active = false;
      window.clearInterval(this.timer);
      window.clearTimeout(this.pendingTimer);
      this.timer = null;
      this.pendingTimer = null;
      if (this.recorder && this.recorder.state !== 'inactive') try { this.recorder.stop(); } catch (_) {}
      this.recorder = null;
      if (this.speechRecognition) { this.speechRecognition.onend = null; try { this.speechRecognition.stop(); } catch (_) {} }
      this.speechRecognition = null;
      this.stopStream();
    }
  }
  window.KashfAudioController = KashfAudioController;
})();
