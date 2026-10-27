// Questions and scoring for the before-you-play questionnaire. Wording is signed off in docs/questionnaire.md.
export const AXES = ['explore', 'read', 'challenge', 'persist', 'look', 'social', 'pace'] as const;
export type Axis = typeof AXES[number];
export type Answer = 'a' | 'b';
export type Question = { id: number; axis: Axis; text: string; a: string; b: string };

// Scores run from -1 (all A) to +1 (all B). A is: explore, read, challenge, stick with it, look, show, fast.
export const QUESTIONS: Question[] = [
  { id: 1, axis: 'explore', text: 'You start a new game. What do you do first?', a: 'Poke around and see what everything does.', b: "Find out what I'm supposed to do and do it." },
  { id: 2, axis: 'explore', text: "There's a door off to the side that doesn't go toward the goal.", a: 'Go in. Obviously.', b: "Skip it. Maybe I'll come back." },
  { id: 3, axis: 'read', text: 'A game shows you a page of instructions.', a: 'I read it.', b: 'I skip it and figure it out.' },
  { id: 4, axis: 'read', text: "You're stuck. What helps most?", a: 'Reading the hint.', b: 'Trying stuff until something works.' },
  { id: 5, axis: 'challenge', text: 'Which sounds better?', a: 'A really hard level I beat on the tenth try.', b: "An easy level that's fun the whole way." },
  { id: 6, axis: 'persist', text: 'You lose three times in a row.', a: "Try again. I've almost got it.", b: 'Go do something else for a while.' },
  { id: 7, axis: 'persist', text: 'A game gets hard really fast.', a: 'Now I want to beat it even more.', b: "I'm kind of done with it." },
  { id: 8, axis: 'look', text: 'What makes you want to play a game?', a: 'It looks cool.', b: 'It has a cool trick to figure out.' },
  { id: 9, axis: 'look', text: 'Pick one.', a: 'Unlocking every character and look.', b: 'Figuring out the best way to win.' },
  { id: 10, axis: 'social', text: 'You beat a hard level.', a: 'Show somebody right away.', b: 'Just keep going.' },
  { id: 11, axis: 'pace', text: 'How do you like to play?', a: 'Fast. I figure it out as I go.', b: 'Slow. I think before I move.' },
  { id: 12, axis: 'explore', text: 'A game with no score and no winning, just stuff to mess around with.', a: 'Sounds fun.', b: "What's the point?" },
];

export function scoreAnswers(answers: Record<number, Answer>): Record<Axis, number | null> {
  const sums = Object.fromEntries(AXES.map(a => [a, [] as number[]])) as Record<Axis, number[]>;
  for (const q of QUESTIONS) {
    const v = answers[q.id];
    if (v === 'a') sums[q.axis].push(-1);
    else if (v === 'b') sums[q.axis].push(1);
  }
  return Object.fromEntries(AXES.map(a => {
    const xs = sums[a];
    return [a, xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null];
  })) as Record<Axis, number | null>;
}
