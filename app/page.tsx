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
import { useRingtone } from '@/lib/use-ringtone';
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
  const [ultravoxCallSessionId, setUltravoxCallSessionId] = useState<string | null>(null);

  const log = useCallback((text: string, kind: StreamEntry['kind'] = 'info') => {
    setStream((s) => [...s, { ts: now(), text, kind }]);
  }, []);

  const ux = useUltravox();
  const tg = useTelugu();
  const rt = useRingtone();
  const isTelugu = language === 'te-in';

  const showRinging = calling && (
    isTelugu 
      ? (tg.status === 'connecting')
      : (ux.status === 'idle' || ux.status === 'connecting' || ux.status === 'disconnected')
  );

  useEffect(() => {
    if (showRinging) {
      rt.play();
    } else {
      rt.stop();
    }
  }, [showRinging, rt]);

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
    setUltravoxCallSessionId(data.callSessionId);
    ux.join(data.joinUrl);
    log('Connected', 'ok');
  }, [language, voice, persona, log, ux]);

  const startTelugu = useCallback(async (fullUrl: string) => {
    log(`Preparing Telugu context for ${fullUrl}`);
    setStartedAt(Date.now());
    await tg.start({ url: fullUrl, persona, voice });
    log('Live: Bhavik and you are now on the line — speak naturally', 'ok');
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
    if (isTelugu) {
      tg.end(); // hook fires its own /api/end-call
    } else {
      await ux.leave();
      const cs = ultravoxCallSessionId;
      setUltravoxCallSessionId(null);
      if (cs) {
        void fetch('/api/end-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ callSessionId: cs, status: 'ended' }),
          keepalive: true,
        }).catch(() => {});
      }
    }
    setCalling(false);
    setStartedAt(null);
    log('Call ended', 'ok');
  }, [log, isTelugu, tg, ux, ultravoxCallSessionId]);

  const handleCallButton = useCallback(async () => {
    if (!calling) return start();
    await end();
  }, [calling, end, start]);

  const ultravoxActive = !isTelugu && calling && (ux.status === 'listening' || ux.status === 'speaking' || ux.status === 'thinking' || ux.status === 'idle' || ux.status === 'connecting');
  const teluguActive = isTelugu && calling && tg.status !== 'idle' && tg.status !== 'ended';
  const callActive = ultravoxActive || teluguActive;

  const messages = isTelugu ? tg.messages : ux.messages;
  const micLevel = isTelugu ? tg.micLevel : ux.micLevel;
  const liveStatus = isTelugu ? tg.status : ux.status;
  const displayStatus = showRinging ? 'ringing' : liveStatus;

  const buttonLabel = calling ? 'END CALL' : 'INITIATE CALL';

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
            <span className="status-text">{calling ? displayStatus.toUpperCase() : 'STANDBY'}</span>
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
          <AgentCard statusText={calling ? (showRinging ? 'Ringing...' : liveStatus) : 'Ready'} active={callActive} />
          <CallButton
            active={calling}
            label={buttonLabel}
            onClick={handleCallButton}
            disabled={false}
          />
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
