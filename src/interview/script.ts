// What the interview page shows and what each tap means. Shared by the page (via /api/interview) and the step that
// reads a recorded interview back. Kid-facing words: signed off by Joel before use.

// The kid's own words for a reaction, and the label each one stands for.
export const FEELINGS: { word: string; label: string }[] = [
  { word: 'Confused', label: 'confused' },
  { word: 'Stuck', label: 'stuck' },
  { word: 'Bored', label: 'bored' },
  { word: 'Annoyed', label: 'frustrated' },
  { word: 'Concentrating', label: 'focused' },
  { word: 'Into it', label: 'engaged' },
  { word: 'Loving it', label: 'delighted' },
  { word: 'Nothing much', label: 'none' },
];

// One pitch per thing a kid might be playing for. `drive` stays off the screen.
export const PITCHES: { id: string; drive: string; text: string }[] = [
  { id: 'faster', drive: 'speed', text: 'The same level, a little faster every time. How long can you last?' },
  { id: 'one-answer', drive: 'mastery', text: 'Every level is a puzzle with exactly one right answer.' },
  { id: 'build', drive: 'creativity', text: "Build anything you want. There's no goal and no timer." },
  { id: 'race', drive: 'competition', text: 'Race your brother or sister. Whoever finishes first wins.' },
  { id: 'collect', drive: 'collection', text: 'Collect all 100 creatures. Some of them are really rare.' },
  { id: 'story', drive: 'story', text: 'A story where the choices you make change what happens.' },
  { id: 'secret-map', drive: 'exploration', text: 'A big map full of secret places, and nobody tells you where to go.' },
  { id: 'scoreboard', drive: 'showing', text: 'Your best score goes on a board the whole family can see.' },
  { id: 'robot', drive: 'nurturing', text: 'Teach a little robot how to do things, one step at a time.' },
  { id: 'again', drive: 'grind', text: 'A short game you play over and over, getting a tiny bit better each time.' },
];

export const ANSWERS = ['Yes!', 'Maybe', 'Nope'] as const;

export const COPY = {
  intro: "We're going to watch a few bits of you playing. There are no wrong answers. I just want to know what it was like for you.",
  clipAsk: 'What was going on here?',
  clipPick: 'Which word fits best?',
  gamesAsk: 'Which game was the most fun? Which one was the least fun? What made it that way?',
  pitchIntro: "Now some game ideas. For each one, tell me if you'd want to play it, and why.",
  pitchAsk: 'Would you want to play this?',
  last: 'Out of all those ideas, which one would you pick first?',
  done: "That's it. Thanks!",
};
