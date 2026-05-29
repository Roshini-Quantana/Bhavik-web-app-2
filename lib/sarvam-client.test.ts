import { describe, it, expect } from 'vitest';
import { stripThinkTags, sarvamTts } from './sarvam-client';

describe('stripThinkTags', () => {
  it('removes a balanced think block', () => {
    expect(stripThinkTags('<think>plan stuff</think>hello')).toBe('hello');
  });
  it('removes a multiline think block', () => {
    const input = '<think>\nline a\nline b\n</think>\nNamaste!';
    expect(stripThinkTags(input)).toBe('Namaste!');
  });
  it('removes an unclosed think tag at the end (truncated reply)', () => {
    expect(stripThinkTags('Hi there.<think>partial reason')).toBe('Hi there.');
  });
  it('returns trimmed text unchanged when no tags', () => {
    expect(stripThinkTags('  plain text  ')).toBe('plain text');
  });
});

describe('sarvamTts empty-text guard', () => {
  it('throws before HTTP when text is empty string', async () => {
    await expect(sarvamTts('key', { text: '', language: 'te-IN' })).rejects.toThrow(/text is empty/);
  });
  it('throws before HTTP when text is whitespace only', async () => {
    await expect(sarvamTts('key', { text: '   \n\t  ', language: 'te-IN' })).rejects.toThrow(/text is empty/);
  });
});
