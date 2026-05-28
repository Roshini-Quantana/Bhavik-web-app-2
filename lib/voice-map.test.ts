import { describe, it, expect } from 'vitest';
import { pickVoice } from './voice-map';

describe('pickVoice', () => {
  it('maps en + male', () => {
    expect(pickVoice('en-us', 'male')).toBe('Mark');
    expect(pickVoice('en-in', 'male')).toBe('Mark');
  });
  it('maps en + female', () => {
    expect(pickVoice('en-gb', 'female')).toBe('Jessica');
  });
  it('maps en + neutral', () => {
    expect(pickVoice('en-au', 'neutral')).toBe('Cassidy');
  });
  it('maps hi-in + male', () => {
    expect(pickVoice('hi-in', 'male')).toBe('Anjali-Hindi-Urdu');
  });
  it('maps hi-in + female', () => {
    expect(pickVoice('hi-in', 'female')).toBe('Riya-Rao-Hindi-Urdu');
  });
  it('maps te-in + male', () => {
    expect(pickVoice('te-in', 'male')).toBe('Krishna-Telugu');
  });
  it('maps te-in + female', () => {
    expect(pickVoice('te-in', 'female')).toBe('Sita-Telugu');
  });
});
