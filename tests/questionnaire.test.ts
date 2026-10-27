import { describe, it, expect } from 'vitest';
import { QUESTIONS, scoreAnswers, AXES } from '../src/server/questionnaire.ts';

const all = (pick: 'a' | 'b') => Object.fromEntries(QUESTIONS.map(q => [q.id, pick]));

describe('questionnaire scoring', () => {
  it('has 12 questions covering every axis', () => {
    expect(QUESTIONS).toHaveLength(12);
    expect(new Set(QUESTIONS.map(q => q.axis))).toEqual(new Set(AXES));
  });
  it('scores all A as -1 and all B as +1 on every axis', () => {
    expect(Object.values(scoreAnswers(all('a')))).toEqual(AXES.map(() => -1));
    expect(Object.values(scoreAnswers(all('b')))).toEqual(AXES.map(() => 1));
  });
  it('averages mixed answers within an axis', () => {
    expect(scoreAnswers({ 1: 'a', 2: 'b', 12: 'a' }).explore).toBeCloseTo(-1 / 3);
  });
  it('skips unanswered questions and returns null for an empty axis', () => {
    const s = scoreAnswers({ 3: 'b' });
    expect(s.read).toBe(1);
    expect(s.pace).toBeNull();
  });
  it('ignores unknown ids and bad values', () => {
    expect(scoreAnswers({ 99: 'a', 3: 'x' as any }).read).toBeNull();
  });
});
