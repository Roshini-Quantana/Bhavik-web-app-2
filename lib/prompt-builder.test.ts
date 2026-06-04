import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './prompt-builder';

const ctx = {
  company_name: 'Acme',
  summary: 'They sell widgets to factories.',
  industry: 'Industrial',
};

describe('buildSystemPrompt', () => {
  it('includes company fields', () => {
    const p = buildSystemPrompt(ctx, 'Professional', 'en-us');
    expect(p).toContain('Acme');
    expect(p).toContain('widgets to factories');
    expect(p).toContain('Industrial');
  });

  it('embeds persona tone', () => {
    const p = buildSystemPrompt(ctx, 'Friendly', 'en-us');
    expect(p.toLowerCase()).toContain('warm');
  });

  it('embeds language directive for Hindi', () => {
    const p = buildSystemPrompt(ctx, 'Direct', 'hi-in');
    expect(p.toLowerCase()).toContain('hindi');
  });

  it('embeds language directive for Arabic', () => {
    const p = buildSystemPrompt(ctx, 'Direct', 'ar');
    expect(p.toLowerCase()).toContain('arabic');
    expect(p).toContain('شركتك');
  });

  it('falls back gracefully when company fields are empty', () => {
    const p = buildSystemPrompt(
      { company_name: '', summary: '', industry: '' },
      'Professional',
      'en-us'
    );
    expect(p).toContain('came across your company');
  });

  it('always tells agent not to reveal AI identity', () => {
    const p = buildSystemPrompt(ctx, 'Professional', 'en-us');
    expect(p.toLowerCase()).toContain('never reveal');
  });
});
