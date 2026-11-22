import { STRENGTH_ROUTINE, type Exercise } from './strength';

/**
 * The guided session, one screen at a time: each exercise set by set (and
 * side by side), with a rest after each one except the last. Same order and
 * rests as the watch.
 */
export const REST_SECONDS = 30;

export type SessionStep = {
  exercise: Exercise;
  /** 0-based exercise number. */
  index: number;
  /** 1-based set. */
  set: number;
  side: 'derecha' | 'izquierda' | null;
  rest: boolean;
  /** Timed hold or rest; null = reps (tap when done). */
  seconds: number | null;
};

export function sessionSteps(routine: Exercise[] = STRENGTH_ROUTINE): SessionStep[] {
  const out: SessionStep[] = [];
  routine.forEach((exercise, index) => {
    for (let set = 1; set <= exercise.guide.sets; set++) {
      const sides = exercise.guide.sides ? (['derecha', 'izquierda'] as const) : [null];
      for (const side of sides) {
        out.push({ exercise, index, set, side, rest: false, seconds: exercise.guide.seconds ?? null });
        out.push({ exercise, index, set, side, rest: true, seconds: REST_SECONDS });
      }
    }
  });
  if (out.length && out[out.length - 1].rest) out.pop();
  return out;
}

/** The first step of the next exercise (skipping the rest of this one). */
export function skipExercise(steps: SessionStep[], at: number): number {
  const current = steps[at]?.index;
  let i = at;
  while (i < steps.length && steps[i].index === current) i++;
  return i;
}
