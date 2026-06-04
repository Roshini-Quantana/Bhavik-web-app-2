'use client';

import type { Language, VoiceGender, Persona } from '@/lib/types';

interface Props {
  url: string;
  setUrl: (v: string) => void;
  language: Language;
  setLanguage: (v: Language) => void;
  voice: VoiceGender;
  setVoice: (v: VoiceGender) => void;
  persona: Persona;
  setPersona: (v: Persona) => void;
  disabled: boolean;
}

const PERSONAS: Persona[] = ['Professional', 'Friendly', 'Direct', 'Consultative'];

export default function ConfigPanel(p: Props) {
  return (
    <>
      <section className="card" id="target-intel-card">
        <div className="card-header"><span className="card-label">TARGET INTEL</span></div>
        <div className="url-input-group">
          <span className="url-prefix">https://</span>
          <input
            type="text"
            id="target-url"
            className="url-input"
            placeholder="company.com"
            autoComplete="off"
            value={p.url}
            disabled={p.disabled}
            onChange={(e) => p.setUrl(e.target.value)}
          />
        </div>
      </section>

      <section className="card" id="voice-config-card">
        <div className="card-header"><span className="card-label">VOICE CONFIG</span></div>
        <div className="select-row">
          <div className="custom-select-wrapper">
            <select
              className="custom-select"
              value={p.language}
              disabled={p.disabled}
              onChange={(e) => p.setLanguage(e.target.value as Language)}
            >
              <option value="en-in">EN — India</option>
              <option value="en-us">EN — USA</option>
              <option value="en-gb">EN — UK</option>
              <option value="en-au">EN — Australia</option>
              <option value="hi-in">HI — India</option>
              <option value="te-in">TE — India</option>
              <option value="ar">AR — Arabic</option>
            </select>
            <span className="select-arrow">▾</span>
          </div>
          <div className="custom-select-wrapper">
            <select
              className="custom-select"
              value={p.voice}
              disabled={p.disabled}
              onChange={(e) => p.setVoice(e.target.value as VoiceGender)}
            >
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
            <span className="select-arrow">▾</span>
          </div>
        </div>
      </section>

      <section className="card" id="persona-card">
        <div className="card-header"><span className="card-label">PERSONA</span></div>
        <div className="persona-grid">
          {PERSONAS.map((name, i) => (
            <button
              key={name}
              className={`persona-tag${p.persona === name ? ' active' : ''}`}
              disabled={p.disabled}
              onClick={() => p.setPersona(name)}
            >
              <span className="persona-dot"></span>{name}
              <span className="persona-key">P{i + 1}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
