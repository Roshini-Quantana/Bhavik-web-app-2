'use client';

import { useState, useEffect, useCallback } from 'react';
import ConfigPanel from '@/components/ConfigPanel';
import AgentCard from '@/components/AgentCard';
import CallButton from '@/components/CallButton';
import Waveform from '@/components/Waveform';
import StreamPanel, { StreamEntry } from '@/components/StreamPanel';
import Transcript from '@/components/Transcript';
import StatsBar from '@/components/StatsBar';
import { useUltravox } from '@/lib/use-ultravox';
import { useTelugu } from '@/lib/use-telugu';
import type { Language, VoiceGender, Persona, PrepareContextResponse } from '@/lib/types';

function now() {
  return new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function Page() {
  const [url, setUrl] = useState('');
  const [language, setLanguage] = useState<Language>('en-in');
  const [voice, setVoice] = useState<VoiceGender>('male');
  const [persona, setPersona] = useState<Persona>('Professional');

  const [calling, setCalling] = useState(false);
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const log = useCallback((text: string, kind: StreamEntry['kind'] = 'info') => {
    setStream((s) => [...s, { ts: now(), text, kind }]);
  }, []);

  const ux = useUltravox();
  const tg = useTelugu();
  const isTelugu = language === 'te-in';

  useEffect(() => {
    if (!startedAt) {
      setDuration(0);
      return;
    }
    const i = setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(i);
  }, [startedAt]);

  const startUltravox = useCallback(async (fullUrl: string) => {
    log(`Preparing context for ${fullUrl}`);
    const res = await fetch('/api/prepare-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl, language, voice, persona }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error ?? res.statusText);
    }
    const data: PrepareContextResponse = await res.json();
    log(`Got Ultravox session. Company: ${data.companyContext.company_name || '(unknown)'}`, 'ok');
    log('Joining call…');
    setStartedAt(Date.now());
    ux.join(data.joinUrl);
    log('Connected', 'ok');
  }, [language, voice, persona, log, ux]);

  const startTelugu = useCallback(async (fullUrl: string) => {
    log(`Preparing Telugu context for ${fullUrl}`);
    setStartedAt(Date.now());
    await tg.start({ url: fullUrl, persona, voice });
    log('Bhavik speaking in Telugu', 'ok');
    log('Click the call button again to record your reply', 'info');
  }, [log, tg, persona, voice]);

  const start = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      log('URL required', 'err');
      return;
    }
    setCalling(true);
    setStream([]);
    try {
      const fullUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
      if (isTelugu) await startTelugu(fullUrl);
      else await startUltravox(fullUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`error: ${msg}`, 'err');
      setCalling(false);
      setStartedAt(null);
    }
  }, [url, isTelugu, startTelugu, startUltravox, log]);

  const end = useCallback(async () => {
    log('Ending call…');
    if (isTelugu) tg.end();
    else await ux.leave();
    setCalling(false);
    setStartedAt(null);
    log('Call ended', 'ok');
  }, [log, isTelugu, tg, ux]);

  const handleCallButton = useCallback(async () => {
    if (!calling) return start();
    if (isTelugu) {
      // mid-call press: toggle recording. End via dedicated control below.
      if (tg.status === 'recording') {
        log('Sending your reply…');
        try { await tg.toggleRecording(); } catch (e) {
          log(`turn error: ${e instanceof Error ? e.message : e}`, 'err');
        }
      } else if (tg.status === 'ready' || tg.status === 'speaking') {
        log('Listening… click again to send', 'info');
        try { await tg.toggleRecording(); } catch (e) {
          log(`mic error: ${e instanceof Error ? e.message : e}`, 'err');
        }
      } else {
        log(`Telugu busy (${tg.status})…`);
      }
    } else {
      await end();
    }
  }, [calling, isTelugu, tg, end, start, log]);

  const ultravoxActive = !isTelugu && calling && (ux.status === 'listening' || ux.status === 'speaking' || ux.status === 'thinking' || ux.status === 'idle');
  const teluguActive = isTelugu && calling && tg.status !== 'idle' && tg.status !== 'ended';
  const callActive = ultravoxActive || teluguActive;

  const messages = isTelugu ? tg.messages : ux.messages;
  const micLevel = isTelugu ? tg.micLevel : ux.micLevel;
  const liveStatus = isTelugu ? tg.status : ux.status;

  let buttonLabel = 'INITIATE CALL';
  if (calling) {
    if (isTelugu) {
      if (tg.status === 'recording') buttonLabel = 'STOP & SEND';
      else if (tg.status === 'ready' || tg.status === 'speaking') buttonLabel = 'TAP TO SPEAK';
      else if (tg.status === 'thinking') buttonLabel = 'THINKING…';
      else buttonLabel = 'CONNECTING…';
    } else {
      buttonLabel = 'END CALL';
    }
  }

  return (
    <>
      <nav className="topnav">
        <div className="topnav-left">
          <span className="brand">BHAVIK</span>
          <div className="nav-tags">
            <span className="nav-tag">AI VOICE AGENT</span>
            <span className="nav-tag">COLD CALL OS</span>
            {isTelugu && <span className="nav-tag">SARVAM · TE</span>}
          </div>
        </div>
        <div className="topnav-right">
          <div className={`status-badge${calling ? ' calling' : ''}`}>
            <span className="status-dot"></span>
            <span className="status-text">{calling ? liveStatus.toUpperCase() : 'STANDBY'}</span>
            <span className="status-version">v2.0</span>
          </div>
        </div>
      </nav>
      <main className="layout">
        <aside className="panel panel-left">
          <ConfigPanel
            url={url}
            setUrl={setUrl}
            language={language}
            setLanguage={setLanguage}
            voice={voice}
            setVoice={setVoice}
            persona={persona}
            setPersona={setPersona}
            disabled={calling}
          />
          <AgentCard statusText={calling ? liveStatus : 'Ready'} active={callActive} />
          <CallButton
            active={calling && (!isTelugu || tg.status === 'recording')}
            label={buttonLabel}
            onClick={handleCallButton}
            disabled={isTelugu && calling && (tg.status === 'thinking' || tg.status === 'connecting' || tg.status === 'speaking')}
          />
          {isTelugu && calling && (
            <button className="call-btn" style={{ background: 'linear-gradient(135deg, #555, #333)', color: '#fff' }} onClick={end}>
              END CALL
            </button>
          )}
        </aside>
        <section className="panel panel-right">
          <Waveform active={callActive} level={micLevel} />
          <StreamPanel entries={stream} />
          <Transcript messages={messages} />
          <StatsBar turns={messages.length} durationSec={duration} />
        </section>
      </main>
    </>
  );
}
