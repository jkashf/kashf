(function (root) {
  const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  const { VAD_CONFIG, decideVad, isCurrentSession } = root.KashfPipeline;

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function createVadStats(startedAt) {
    return { startedAt, totalFrames: 0, voicedFrames: 0, maximumRms: 0, maximumPeak: 0 };
  }

  class KashfAudioController {
    constructor({ speechLanguages, chunkDuration = VAD_CONFIG.chunkDurationMs, vadConfig = VAD_CONFIG } = {}) {
      this.speechLanguages = speechLanguages || {};
      this.chunkDuration = chunkDuration;
      this.vadConfig = { ...VAD_CONFIG, ...vadConfig };
      this.active = false;
      this.sessionId = null;
      this.sequenceNumber = 0;
      this.recorder = null;
      this.stream = null;
      this.chunkTimer = null;
      this.vadTimer = null;
      this.audioContext = null;
      this.analyser = null;
      this.speechRecognition = null;
      this.pendingTranscript = '';
      this.pendingTimer = null;
      this.processingQueue = Promise.resolve();
      this.abortControllers = new Set();
      this.callbacks = {};
      this.sourceLanguage = 'ar';
      this.currentVadStats = null;
      this.acceptVadAfter = 0;
    }

    get isActive() { return this.active; }

    async start({ sessionId, sourceLanguage, sequenceStart = 0 }, callbacks = {}) {
      this.stop();
      this.active = true;
      this.sessionId = sessionId;
      this.sequenceNumber = sequenceStart;
      this.sourceLanguage = sourceLanguage || 'ar';
      this.callbacks = callbacks;
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !root.MediaRecorder) return this.startBrowserSpeech();
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!this.isCurrent(sessionId)) return this.stopStream();
        this.acceptVadAfter = Date.now() + this.vadConfig.startupGracePeriodMs;
        this.startVadMonitor();
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

    isCurrent(sessionId) { return this.active && isCurrentSession(this.sessionId, sessionId); }

    startVadMonitor() {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      if (!AudioContext) throw new Error('Web Audio API is unavailable');
      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.2;
      source.connect(this.analyser);
      const samples = new Float32Array(this.analyser.fftSize);
      this.currentVadStats = createVadStats(Date.now());
      this.vadTimer = root.setInterval(() => {
        if (!this.active || !this.analyser || !this.currentVadStats) return;
        if (Date.now() < this.acceptVadAfter) return;
        this.analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        let peak = 0;
        for (const sample of samples) {
          const absolute = Math.abs(sample);
          sumSquares += sample * sample;
          if (absolute > peak) peak = absolute;
        }
        const rms = Math.sqrt(sumSquares / samples.length);
        const voiced = rms >= this.vadConfig.rmsThreshold && peak >= this.vadConfig.peakThreshold;
        this.currentVadStats.totalFrames += 1;
        if (voiced) this.currentVadStats.voicedFrames += 1;
        this.currentVadStats.maximumRms = Math.max(this.currentVadStats.maximumRms, rms);
        this.currentVadStats.maximumPeak = Math.max(this.currentVadStats.maximumPeak, peak);
      }, this.vadConfig.sampleIntervalMs);
    }

    createRecorder(mimeType) {
      let chunks = [];
      let chunkStartedAt = Date.now();
      this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {});
      this.recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      this.recorder.onstop = () => {
        const endedAt = Date.now();
        const type = this.recorder?.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const stats = { ...(this.currentVadStats || createVadStats(chunkStartedAt)), durationMs: endedAt - chunkStartedAt };
        const vad = decideVad(stats, this.vadConfig);
        const metadata = {
          sessionId: this.sessionId,
          sequenceNumber: this.sequenceNumber++,
          startedAt: chunkStartedAt,
          endedAt,
          timestamp: new Date(endedAt).toISOString(),
          vad
        };
        chunks = [];
        chunkStartedAt = endedAt;
        this.currentVadStats = createVadStats(endedAt);
        if (vad.isSpeech && blob.size > 0) this.enqueueTranscription(blob, metadata);
        else this.callbacks.onRejected?.('VAD', metadata);
      };
      this.recorder.start();
      this.chunkTimer = root.setInterval(() => {
        if (!this.active || !this.recorder || this.recorder.state !== 'recording') return;
        this.recorder.stop();
        root.setTimeout(() => {
          if (!this.active || !this.recorder || this.recorder.state !== 'inactive') return;
          try { this.recorder.start(); } catch (_) { this.callbacks.onError?.('TRANSCRIPTION_ERROR'); }
        }, 300);
      }, this.chunkDuration);
    }

    enqueueTranscription(blob, metadata) {
      this.processingQueue = this.processingQueue
        .then(() => this.transcribe(blob, metadata))
        .catch(error => console.error('[audio] queue failed', error));
    }

    async transcribe(blob, metadata) {
      if (!this.isCurrent(metadata.sessionId)) return;
      const abortController = new AbortController();
      this.abortControllers.add(abortController);
      this.callbacks.onStatus?.('processing');
      try {
        const audio = await blobToBase64(blob);
        if (!this.isCurrent(metadata.sessionId)) return;
        const response = await fetch('/api/whisper', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({ audio, srcLang: this.sourceLanguage, mimeType: blob.type || 'audio/webm' })
        });
        const data = await response.json().catch(() => ({}));
        if (!this.isCurrent(metadata.sessionId)) return;
        if (!response.ok) {
          const code = data.error && data.error.code ? data.error.code : 'TRANSCRIPTION_ERROR';
          if (code === 'NO_SPEECH') this.callbacks.onRejected?.('NO_SPEECH_METADATA', metadata);
          else this.callbacks.onError?.(code, metadata);
          return;
        }
        if (data.text && data.text.trim()) await this.callbacks.onTranscript?.(data.text.trim(), metadata);
      } catch (error) {
        if (error.name !== 'AbortError' && this.isCurrent(metadata.sessionId)) {
          console.error('[audio] request failed', { name: error.name, message: error.message });
          this.callbacks.onError?.('NETWORK_ERROR', metadata);
        }
      } finally {
        this.abortControllers.delete(abortController);
        if (this.isCurrent(metadata.sessionId)) this.callbacks.onStatus?.('listening');
      }
    }

    startBrowserSpeech() {
      const SpeechRecognition = root.SpeechRecognition || root.webkitSpeechRecognition;
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
          root.clearTimeout(this.pendingTimer);
          this.pendingTimer = root.setTimeout(() => {
            const text = this.pendingTranscript.trim();
            this.pendingTranscript = '';
            const endedAt = Date.now();
            const metadata = {
              sessionId: this.sessionId,
              sequenceNumber: this.sequenceNumber++,
              startedAt: endedAt,
              endedAt,
              timestamp: new Date(endedAt).toISOString(),
              vad: null
            };
            if (text && this.isCurrent(metadata.sessionId)) {
              this.processingQueue = this.processingQueue
                .then(() => this.callbacks.onTranscript?.(text, metadata))
                .catch(error => console.error('[audio] browser transcript queue failed', error));
            }
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

    stopStream() {
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    stop() {
      this.active = false;
      this.abortControllers.forEach(controller => controller.abort());
      this.abortControllers.clear();
      root.clearInterval(this.chunkTimer);
      root.clearInterval(this.vadTimer);
      root.clearTimeout(this.pendingTimer);
      this.chunkTimer = null;
      this.vadTimer = null;
      this.pendingTimer = null;
      if (this.recorder && this.recorder.state !== 'inactive') try { this.recorder.stop(); } catch (_) {}
      this.recorder = null;
      if (this.speechRecognition) {
        this.speechRecognition.onend = null;
        try { this.speechRecognition.stop(); } catch (_) {}
      }
      this.speechRecognition = null;
      this.stopStream();
      if (this.audioContext) this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.analyser = null;
      this.currentVadStats = null;
      this.acceptVadAfter = 0;
      this.sessionId = null;
      this.processingQueue = Promise.resolve();
    }
  }

  root.KashfAudioController = KashfAudioController;
})(typeof globalThis !== 'undefined' ? globalThis : this);
