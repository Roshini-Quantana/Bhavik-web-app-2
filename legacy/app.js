/* ═══════════════════════════════════════════════════════════
   BHAVIK · AI COLD CALL OS — APPLICATION LOGIC
   ═══════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────
  const state = {
    isCallActive: false,
    callStartTime: null,
    timerInterval: null,
    turns: 0,
    selectedPersona: 'Professional',
    waveAnimFrame: null,
    streamLines: [],
    transcriptMessages: [],
    sentimentScore: 0.4,   // 0 to 1
    intentScore:   0.4,
  };

  // ── DOM refs ───────────────────────────────────────────
  const $ = (id) => document.getElementById(id);

  const els = {
    statusDot:       $('status-dot'),
    statusText:      $('status-text'),
    statusBadge:     $('status-badge'),
    callBtn:         $('call-btn'),
    callBtnText:     $('call-btn-text'),
    agentReadyText:  $('agent-ready-text'),
    agentPulse:      $('agent-pulse'),
    waveformCanvas:  $('waveform-canvas'),
    waveformOverlay: $('waveform-overlay'),
    waveformBadge:   $('waveform-badge'),
    streamContent:   $('stream-content'),
    transcriptContent:$('transcript-content'),
    transcriptEmpty: $('transcript-empty'),
    transcriptMsgs:  $('transcript-msgs'),
    turnsValue:      $('turns-value'),
    durationValue:   $('duration-value'),
    sentimentBar:    $('sentiment-bar'),
    intentBar:       $('intent-bar'),
    urlInput:        $('target-url'),
    urlSearchBtn:    $('url-search-btn'),
  };

  // ── Persona selection ──────────────────────────────────
  document.querySelectorAll('.persona-tag').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.persona-tag').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedPersona = btn.dataset.persona;
      addStreamLine(`Persona switched → ${state.selectedPersona}`, 'active');
    });
  });

  // ── Call button ────────────────────────────────────────
  els.callBtn.addEventListener('click', () => {
    if (!state.isCallActive) {
      startCall();
    } else {
      endCall();
    }
  });

  // ── URL search ─────────────────────────────────────────
  els.urlSearchBtn.addEventListener('click', () => {
    const url = els.urlInput.value.trim();
    if (url) {
      addStreamLine(`Scanning target: https://${url}`, 'active');
      setTimeout(() => addStreamLine('Target intel loaded ✓', 'done'), 1400);
    }
  });

  els.urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') els.urlSearchBtn.click();
  });

  // ── START CALL ─────────────────────────────────────────
  function startCall() {
    const url = els.urlInput.value.trim();
    if (!url) {
      els.urlInput.focus();
      els.urlInput.style.borderColor = 'var(--red-dim)';
      setTimeout(() => els.urlInput.style.borderColor = '', 1500);
      addStreamLine('⚠ Please enter a target URL first', 'active');
      return;
    }

    state.isCallActive = true;
    state.callStartTime = Date.now();
    state.turns = 0;

    // UI transitions
    els.callBtn.classList.add('calling');
    els.callBtnText.textContent = 'END CALL';
    els.callBtn.querySelector('.call-icon').style.transform = 'rotate(135deg)';

    els.statusText.textContent = 'LIVE';
    els.statusBadge.classList.add('active', 'calling');

    els.agentReadyText.textContent = 'On Call';
    els.agentReadyText.style.color = 'var(--green)';

    els.waveformBadge.textContent = 'LIVE';
    els.waveformBadge.classList.add('live');
    els.waveformOverlay.classList.add('hidden');
    els.waveformCanvas.classList.add('visible');

    // Start timer
    state.timerInterval = setInterval(updateTimer, 1000);

    // Start waveform
    startWaveform();

    // Simulate AI stream
    simulateStream();
  }

  // ── END CALL ───────────────────────────────────────────
  function endCall() {
    state.isCallActive = false;

    // Stop timer
    clearInterval(state.timerInterval);
    state.timerInterval = null;

    // Stop waveform
    if (state.waveAnimFrame) {
      cancelAnimationFrame(state.waveAnimFrame);
      state.waveAnimFrame = null;
    }
    clearWaveform();

    // UI transitions
    els.callBtn.classList.remove('calling');
    els.callBtnText.textContent = 'INITIATE CALL';
    els.callBtn.querySelector('.call-icon').style.transform = '';

    els.statusText.textContent = 'STANDBY';
    els.statusBadge.classList.remove('active', 'calling');

    els.agentReadyText.textContent = 'Ready';
    els.agentReadyText.style.color = '';

    els.waveformBadge.textContent = 'IDLE';
    els.waveformBadge.classList.remove('live');
    els.waveformOverlay.classList.remove('hidden');
    els.waveformCanvas.classList.remove('visible');

    addStreamLine('Call ended · Summary generating…', 'done');
    setTimeout(() => addStreamLine(`Total turns: ${state.turns} · Duration: ${els.durationValue.textContent}`, 'done'), 900);
  }

  // ── TIMER ──────────────────────────────────────────────
  function updateTimer() {
    const elapsed = Math.floor((Date.now() - state.callStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    els.durationValue.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ── WAVEFORM ───────────────────────────────────────────
  const waveCtx = els.waveformCanvas.getContext('2d');
  let wavePhase = 0;

  function startWaveform() {
    const canvas = els.waveformCanvas;
    const container = canvas.parentElement;

    const resize = () => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
    };

    resize();
    new ResizeObserver(resize).observe(container);

    function draw() {
      if (!state.isCallActive) return;

      const w = canvas.width;
      const h = canvas.height;
      const ctx = waveCtx;

      ctx.clearRect(0, 0, w, h);

      // Background gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0b0f1200');
      bgGrad.addColorStop(1, '#0b0f1200');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // Draw multiple wave layers
      const layers = [
        { amp: 0.35, freq: 0.025, speed: 0.05, alpha: 0.8,  color: '#00ff9d' },
        { amp: 0.20, freq: 0.040, speed: 0.08, alpha: 0.4,  color: '#00ff9d' },
        { amp: 0.12, freq: 0.060, speed: 0.12, alpha: 0.25, color: '#00ccff' },
      ];

      layers.forEach((layer, i) => {
        const phase = wavePhase * layer.speed + i * 1.2;
        const mid = h / 2;
        const ampPx = h * layer.amp;

        ctx.beginPath();
        ctx.moveTo(0, mid);

        for (let x = 0; x <= w; x++) {
          const noise = (Math.random() - 0.5) * 0.08 * h;
          const y = mid
            + Math.sin(x * layer.freq + phase) * ampPx
            + Math.sin(x * layer.freq * 2.3 + phase * 1.7) * ampPx * 0.4
            + noise;
          ctx.lineTo(x, y);
        }

        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, layer.color + Math.round(layer.alpha * 255).toString(16).padStart(2, '0'));
        grad.addColorStop(1, layer.color + '00');
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke line
        ctx.beginPath();
        ctx.moveTo(0, mid);
        for (let x = 0; x <= w; x++) {
          const y = mid
            + Math.sin(x * layer.freq + phase) * ampPx
            + Math.sin(x * layer.freq * 2.3 + phase * 1.7) * ampPx * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = layer.color + Math.round(layer.alpha * 200).toString(16).padStart(2, '0');
        ctx.lineWidth = 1.5;
        ctx.shadowColor = layer.color;
        ctx.shadowBlur = 6;
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      wavePhase++;
      state.waveAnimFrame = requestAnimationFrame(draw);
    }

    draw();
  }

  function clearWaveform() {
    const canvas = els.waveformCanvas;
    waveCtx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // ── AI STREAM SIMULATION ───────────────────────────────
  const STREAM_EVENTS = [
    { delay: 300,  msg: 'Connecting to voice engine…', type: 'active' },
    { delay: 900,  msg: 'Voice synthesis ready ✓', type: 'done' },
    { delay: 1400, msg: 'Dialing target…', type: 'active' },
    { delay: 2600, msg: 'Call connected ✓', type: 'done' },
    { delay: 3200, msg: 'Opening statement loading…', type: 'active' },
    { delay: 4000, msg: 'Delivering intro pitch…', type: 'done', transcript: true, speaker: 'agent', text: "Hi! This is Bhavik, an AI assistant calling on behalf of our company. Do you have a quick moment to chat?" },
    { delay: 7500, msg: 'Prospect responded · Analysing sentiment…', type: 'active', transcript: true, speaker: 'prospect', text: "Uh, sure. What is this about?" },
    { delay: 9000, msg: 'Sentiment: Neutral · Intent: Curious', type: 'done' },
    { delay: 9500, msg: 'Generating contextual response…', type: 'active' },
    { delay: 11000, msg: 'Response delivered', type: 'done', transcript: true, speaker: 'agent', text: "We help businesses like yours increase qualified leads by 3x using AI-powered outreach. I'd love to schedule a quick 10-minute demo if that works?" },
    { delay: 14000, msg: 'Prospect considering offer…', type: 'active', transcript: true, speaker: 'prospect', text: "That sounds interesting actually. When are you available?" },
    { delay: 15500, msg: 'Positive intent detected ↑', type: 'done' },
    { delay: 16000, msg: 'Scheduling module activated…', type: 'active' },
    { delay: 17500, msg: 'Meeting slot proposed', type: 'done', transcript: true, speaker: 'agent', text: "I can book you in tomorrow at 2 PM or Friday at 10 AM. Which works better for you?" },
  ];

  function simulateStream() {
    STREAM_EVENTS.forEach(({ delay, msg, type, transcript, speaker, text }) => {
      setTimeout(() => {
        if (!state.isCallActive) return;
        addStreamLine(msg, type);

        if (transcript) {
          state.turns++;
          els.turnsValue.textContent = state.turns;
          addTranscriptMessage(speaker, text);

          // Update sentiment & intent dynamically
          if (speaker === 'prospect') {
            updateStats();
          }
        }
      }, delay);
    });
  }

  // ── STREAM LINES ───────────────────────────────────────
  function addStreamLine(text, type = 'done') {
    const awaiting = els.streamContent.querySelector('.awaiting');
    if (awaiting) awaiting.remove();

    const line = document.createElement('div');
    line.className = `stream-line ${type}`;
    const ts = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    line.textContent = `[${ts}] ${text}`;
    els.streamContent.appendChild(line);

    // Keep only last 5 lines
    const lines = els.streamContent.querySelectorAll('.stream-line');
    if (lines.length > 5) lines[0].remove();

    els.streamContent.scrollTop = els.streamContent.scrollHeight;
  }

  // ── TRANSCRIPT ─────────────────────────────────────────
  function addTranscriptMessage(speaker, text) {
    if (els.transcriptEmpty) {
      const empty = document.querySelector('.transcript-empty');
      if (empty) empty.style.display = 'none';
    }

    const ts = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });
    const msgCount = els.transcriptContent.querySelectorAll('.transcript-msg').length + 1;
    els.transcriptMsgs.textContent = `${msgCount} msg${msgCount > 1 ? 's' : ''}`;

    const msg = document.createElement('div');
    msg.className = 'transcript-msg';
    msg.innerHTML = `
      <div class="transcript-msg-header">
        <span class="transcript-msg-role ${speaker}">${speaker === 'agent' ? 'BHAVIK' : 'PROSPECT'}</span>
        <span class="transcript-msg-time">${ts}</span>
      </div>
      <div class="transcript-msg-body">${text}</div>
    `;

    els.transcriptContent.appendChild(msg);
    els.transcriptContent.scrollTop = els.transcriptContent.scrollHeight;
  }

  // ── STATS ──────────────────────────────────────────────
  function updateStats() {
    // Gradually improve sentiment/intent
    state.sentimentScore = Math.min(1, state.sentimentScore + 0.25);
    state.intentScore    = Math.min(1, state.intentScore    + 0.3);

    renderSentimentBar();
    renderIntentBar();
  }

  function renderSentimentBar() {
    const segs = els.sentimentBar.querySelectorAll('.bar-seg');
    const score = state.sentimentScore;

    segs.forEach((seg, i) => {
      seg.classList.remove('active', 'positive', 'negative');
      const threshold = (i + 1) / segs.length;
      if (score >= threshold) {
        seg.classList.add(score >= 0.7 ? 'positive' : 'active');
      }
    });
  }

  function renderIntentBar() {
    const segs = els.intentBar.querySelectorAll('.int-seg');
    const score = state.intentScore;

    segs.forEach((seg, i) => {
      seg.classList.remove('active', 'strong');
      const threshold = (i + 1) / segs.length;
      if (score >= threshold) {
        seg.classList.add(score >= 0.75 ? 'strong' : 'active');
      }
    });
  }

  // ── Init ───────────────────────────────────────────────
  renderSentimentBar();
  renderIntentBar();

})();
