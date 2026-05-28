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

  useEffect(() => {
    if (!startedAt) {
      setDuration(0);
      return;
    }
    const i = setInterval(() => setDuration(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(i);
  }, [startedAt]);

  const start = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      log('URL required', 'err');
      return;
    }
    setCalling(true);
    setStream([]);
    log(`Preparing context for ${trimmed}`);
    try {
      const fullUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
      const res = await fetch('/api/prepare-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullUrl, language, voice, persona }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        log(`prepare-context failed: ${j.error ?? res.statusText}`, 'err');
        setCalling(false);
        return;
      }
      const data: PrepareContextResponse = await res.json();
      log(`Got Ultravox session. Company: ${data.companyContext.company_name || '(unknown)'}`, 'ok');
      log('Joining call…');
      setStartedAt(Date.now());
      ux.join(data.joinUrl);
      log('Connected', 'ok');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`error: ${msg}`, 'err');
      setCalling(false);
    }
  }, [url, language, voice, persona, log, ux]);

  const end = useCallback(async () => {
    log('Ending call…');
    await ux.leave();
    setCalling(false);
    setStartedAt(null);
    log('Call ended', 'ok');
  }, [log, ux]);

  const callActive = calling && (ux.status === 'listening' || ux.status === 'speaking' || ux.status === 'thinking' || ux.status === 'idle');

  return (
    <>
      <nav className="topnav">
        <div className="topnav-left">
          <span className="brand">BHAVIK</span>
          <div className="nav-tags">
            <span className="nav-tag">AI VOICE AGENT</span>
            <span className="nav-tag">COLD CALL OS</span>
          </div>
        </div>
        <div className="topnav-right">
          <div className={`status-badge${calling ? ' calling' : ''}`}>
            <span className="status-dot"></span>
            <span className="status-text">{calling ? ux.status.toUpperCase() : 'STANDBY'}</span>
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
          <AgentCard statusText={calling ? ux.status : 'Ready'} active={callActive} />
          <CallButton
            active={calling}
            label={calling ? 'END CALL' : 'INITIATE CALL'}
            onClick={calling ? end : start}
          />
        </aside>
        <section className="panel panel-right">
          <Waveform active={callActive} level={ux.micLevel} />
          <StreamPanel entries={stream} />
          <Transcript messages={ux.messages} />
          <StatsBar turns={ux.messages.length} durationSec={duration} />
        </section>
      </main>
    </>
  );
}
