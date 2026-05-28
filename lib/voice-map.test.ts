import { describe, it, expect } from 'vitest';
import { pickVoice } from './voice-map';

describe('pickVoice', () => {
  it('maps en-us male', () => {
    expect(pickVoice('en-us', 'male')).toBe('David');
  });
  it('maps en-us female', () => {
    expect(pickVoice('en-us', 'female')).toBe('Gabrielle');
  });
  it('maps en-gb male', () => {
    expect(pickVoice('en-gb', 'male')).toBe('Clive');
  });
  it('maps en-gb female', () => {
    expect(pickVoice('en-gb', 'female')).toBe('Olivia');
  });
  it('maps en-in male to Indian English voice', () => {
    expect(pickVoice('en-in', 'male')).toBe('Amrut-English-Indian');
  });
  it('maps en-in female to Indian English voice', () => {
    expect(pickVoice('en-in', 'female')).toBe('Saavi-English-Indian');
  });
  it('maps hi-in male', () => {
    expect(pickVoice('hi-in', 'male')).toBe('Krishna-Hindi-Urdu');
  });
  it('maps hi-in female', () => {
    expect(pickVoice('hi-in', 'female')).toBe('Anjali-Hindi-Urdu');
  });
  it('maps te-in to a Hindi-family voice (no native Telugu)', () => {
    expect(pickVoice('te-in', 'male')).toBe('Krishna-Hindi-Urdu');
    expect(pickVoice('te-in', 'female')).toBe('Muskaan-Hindi-Urdu');
  });
});
