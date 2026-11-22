import { describe, expect, it } from 'vitest';
import { STRENGTH_ROUTINE } from './strength';
import { sessionSteps, skipExercise } from './strengthSession';

describe('guided strength session', () => {
  const steps = sessionSteps();

  it('goes set by set and side by side, with a rest after each but the last', () => {
    const squat = steps.filter((s) => s.exercise.id === 'squat');
    expect(squat.map((s) => [s.set, s.side, s.rest])).toEqual([
      [1, null, false],
      [1, null, true],
      [2, null, false],
      [2, null, true],
    ]);
    const stepup = steps.filter((s) => s.exercise.id === 'stepup' && !s.rest);
    expect(stepup.map((s) => `${s.set}-${s.side}`)).toEqual(['1-derecha', '1-izquierda', '2-derecha', '2-izquierda']);
    expect(steps[steps.length - 1].rest).toBe(false);
    // Holds are timed; reps are not.
    expect(steps.find((s) => s.exercise.id === 'balance' && !s.rest)?.seconds).toBe(30);
    expect(steps.find((s) => s.exercise.id === 'squat' && !s.rest)?.seconds).toBeNull();
  });

  it('skipping jumps to the next exercise', () => {
    const i = skipExercise(steps, 1); // in the middle of the squats
    expect(steps[i].exercise.id).toBe(STRENGTH_ROUTINE[1].id);
    expect(steps[i].rest).toBe(false);
  });
});
