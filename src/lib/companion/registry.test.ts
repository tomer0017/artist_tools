import { describe, expect, it } from 'vitest';
import { TOOL_IDS } from '@/lib/account';
import { RECIPES, TOOL_CAPABILITIES, abilitiesOf, canRun, toolsFor, NEEDS } from './registry';
import { ACTION_TYPES, COMPANION_FEATURES, type TipAction } from './model';

// Sketchy's knowledge of the studio (ADR-0024): every tool is known, every
// need leads somewhere real, and no button works unless what it leads to is
// open to the person.

const label = { en: 'Go', he: 'קדימה' };
const open = (overrides: Partial<Parameters<typeof abilitiesOf>[0]> = {}) =>
  abilitiesOf(
    {
      features: ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare', 'export.image', 'export.worksheets'],
      offer: { free: ['tool.study'], pro: ['tool.measure', 'tool.study', 'tool.color', 'tool.grid', 'tool.compare'] },
      learn: { visible: true, modules: { curriculum: 'open', color: null, challenges: 'open' }, key: 'k' },
      ...overrides,
    },
    Object.fromEntries(COMPANION_FEATURES.map((f) => [f, 'open'])),
  );

describe('the registry', () => {
  it('knows every tool of the studio, and every need and plan leads to known tools', () => {
    expect(Object.keys(TOOL_CAPABILITIES).sort()).toEqual([...TOOL_IDS].sort());
    for (const need of NEEDS) expect(toolsFor(need).length).toBeGreaterThan(0);
    for (const steps of Object.values(RECIPES)) for (const tool of steps) expect(TOOL_IDS).toContain(tool);
    expect(toolsFor('values')[0]).toBe('value');
    expect(toolsFor('proportions')[0]).toBe('measure');
  });
});

describe('a button works only when what it leads to is open', () => {
  it('a tool: open, or (locked, absent) not offered', () => {
    const freeOnly = open({ features: ['tool.study', 'export.image'] });
    expect(freeOnly.tool('value')).toBe('open');
    expect(freeOnly.tool('measure')).toBe('locked');
    expect(open({ features: [], offer: { free: [], pro: [] } }).tool('measure')).toBe('absent');
    expect(canRun({ type: 'openTool', tool: 'value', label }, freeOnly)).toBe(true);
    expect(canRun({ type: 'openTool', tool: 'measure', label }, freeOnly)).toBe(false);
  });

  it('Learn: the roulette needs open challenges, the next lesson an open course', () => {
    const noLearn = open({ learn: { visible: false, modules: { curriculum: null, color: null, challenges: null }, key: 'k' } });
    expect(canRun({ type: 'roulette', label }, open())).toBe(true);
    expect(canRun({ type: 'roulette', label }, noLearn)).toBe(false);
    expect(canRun({ type: 'nextLesson', label }, noLearn)).toBe(false);
    expect(canRun({ type: 'openItem', itemId: 'CH-001', label }, open())).toBe(true);
    expect(canRun({ type: 'openLearn', page: 'curriculum', label }, open({ learn: { visible: true, modules: { curriculum: 'locked', color: null, challenges: 'open' }, key: 'k' } }))).toBe(false);
  });

  it('worksheets need the Worksheets feature and Create a Grid', () => {
    expect(canRun({ type: 'worksheets', label }, open())).toBe(true);
    expect(canRun({ type: 'worksheets', label }, open({ features: ['tool.grid'] }))).toBe(false);
  });

  it('nothing works when Sketchy himself, or the capability the action needs, is not open', () => {
    const closed = abilitiesOf(null, {});
    for (const type of ACTION_TYPES) expect(canRun({ type, label } as TipAction, closed)).toBe(false);
    const noRoulette = abilitiesOf(
      { features: ['tool.grid'], offer: { free: [], pro: [] }, learn: { visible: true, modules: { curriculum: 'open', color: null, challenges: 'open' }, key: 'k' } },
      { companion: 'open', tips: 'open', roulette: 'locked', guide: 'open', classroom: 'hidden' },
    );
    expect(canRun({ type: 'roulette', label }, noRoulette)).toBe(false);
    expect(canRun({ type: 'classRoulette', label }, noRoulette)).toBe(false);
    expect(canRun({ type: 'nextLesson', label }, noRoulette)).toBe(true);
  });
});
