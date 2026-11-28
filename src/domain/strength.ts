import { addDays, daysBetween, mondayOf, toDateKey } from './dates';
import type { Activity, DateKey } from './types';

/**
 * Strength, twice a week, as part of the day's goal: the plan says how many
 * minutes of what (lower body, upper body, full body); another app builds the
 * routine. It's done when you tick it, the watch's guided session ends, or a
 * strength workout of about that length reaches Health Connect.
 */
export const STRENGTH_PER_WEEK = 2;
export const STRENGTH_XP = 5;
export const STRENGTH_MINUTES = 30;
/** Light week, low readiness, or a day the coach eased: shorter. */
export const STRENGTH_MINUTES_LIGHT = 20;
/** A workout this much of the target counts (a 27-minute session for 30). */
const ENOUGH = 0.8;
/** The earliest day (0 = Monday) for the week's 1st and 2nd session: Tuesday, then Friday. */
const EARLIEST_DAY = [1, 4];

/**
 * A strength day where you moved this many times the walking goal counts
 * without the strength (the strength then stays on for the next days).
 */
export const BIG_DAY = 2;
export const bigDay = (value: number, target: number) => target > 0 && value >= target * BIG_DAY;

export type StrengthFocus = 'lower' | 'upper' | 'full';
/** Stored with the day's goal (meta.strength): part of that day's goal. */
export type StrengthTarget = { focus: StrengthFocus; minutes: number };

export const FOCUS_NAME: Record<StrengthFocus, string> = {
  lower: 'Lower body',
  upper: 'Upper body',
  full: 'Full body',
};
const ROTATION: StrengthFocus[] = ['lower', 'upper', 'full'];

/** Health Connect exercise types that are a strength workout. */
const STRENGTH_LABELS = new Set([
  'strength training',
  'weightlifting',
  'calisthenics',
  'high intensity interval training',
  'pilates',
  'boot camp',
  'exercise class',
]);
export const isStrengthWorkout = (a: Activity) => a.sport === 'other' && !!a.label && STRENGTH_LABELS.has(a.label);

/** Minutes of strength workouts recorded on a day. */
export function strengthMinutesOn(date: DateKey, activities: Activity[]): number {
  return activities
    .filter((a) => isStrengthWorkout(a) && toDateKey(a.start) === date)
    .reduce((s, a) => s + a.durationS / 60, 0);
}

/** Days with strength done: ticked (or from the watch), or a 15+ minute strength workout recorded. */
export function strengthDoneDays(ticked: DateKey[], activities: Activity[]): DateKey[] {
  const recorded = activities.filter(isStrengthWorkout).map((a) => toDateKey(a.start));
  return [...new Set([...ticked, ...recorded.filter((d) => strengthMinutesOn(d, activities) >= 15)])].sort();
}

/** Is a day's strength part done? */
export function strengthDone(target: StrengthTarget, date: DateKey, ticked: DateKey[], activities: Activity[]): boolean {
  return ticked.includes(date) || strengthMinutesOn(date, activities) >= target.minutes * ENOUGH;
}

export type StrengthDayInput = {
  date: DateKey;
  /** Days with strength done (any week; only this week and yesterday matter). */
  doneDays: DateKey[];
  /** Today's key session, if any. */
  keyKind?: string;
  recovery: boolean;
  /** Light week, low readiness, or eased by the coach. */
  light: boolean;
};

/**
 * Strength today? Twice a week: from Tuesday for the first and Friday for the
 * second, never the day after one (48 h), on a long walk or trek day, or on a
 * recovery day. Not done on its day, it stays on the next ones.
 * The focus rotates lower → upper → full across the weeks.
 */
export function strengthFor(i: StrengthDayInput): StrengthTarget | null {
  const monday = mondayOf(i.date);
  const doneThisWeek = i.doneDays.filter((d) => d >= monday && d < i.date).length;
  if (doneThisWeek >= STRENGTH_PER_WEEK) return null;
  if (i.recovery || i.doneDays.includes(addDays(i.date, -1))) return null;
  if (i.keyKind && i.keyKind !== 'brisk_walk') return null;
  if (daysBetween(monday, i.date) < EARLIEST_DAY[doneThisWeek]) return null;
  const week = Math.floor(daysBetween('2026-01-05', monday) / 7);
  const focus = ROTATION[(((week * STRENGTH_PER_WEEK + doneThisWeek) % 3) + 3) % 3];
  return { focus, minutes: i.light ? STRENGTH_MINUTES_LIGHT : STRENGTH_MINUTES };
}

export type Exercise = {
  id: string;
  name: string;
  /** Sets and reps, or time. */
  dose: string;
  /** What it's for on the trail. */
  why: string;
  /** How to do it, step by step. */
  steps: string[];
  /** What to watch out for, so it doesn't hurt. */
  careful: string[];
  /** An easier version to start with. */
  easier: string;
  /** What to search on YouTube to see it done. */
  video: string;
  /** For the guided session on the watch: sets, and reps or seconds, per side if `sides`. */
  guide: { sets: number; reps?: number; seconds?: number; sides: boolean };
};

/**
 * In Spanish on purpose: technique cues are about safety, so they're in the
 * owner's language. Search links instead of specific videos: they never break,
 * and you pick a teacher you like (ideally a physio or certified trainer).
 */
export const STRENGTH_ROUTINE: Exercise[] = [
  {
    id: 'squat',
    name: 'Sentadilla a la silla',
    dose: '2 series de 10–12',
    why: 'Piernas y cola para subidas y bajadas.',
    steps: [
      'Parate delante de una silla, pies al ancho de la cadera, puntas apenas hacia afuera.',
      'Llevá la cola hacia atrás y abajo, como para sentarte, con los brazos adelante.',
      'Bajá despacio hasta rozar la silla.',
      'Subí empujando el piso con los talones.',
    ],
    careful: [
      'Las rodillas siguen la línea de los pies: que no se vayan hacia adentro.',
      'Espalda recta y pecho arriba; talones siempre apoyados.',
      'Bajá lento (unos 3 segundos).',
    ],
    easier: 'Sentarte del todo en la silla y pararte, con ayuda de las manos en los muslos si hace falta.',
    video: 'sentadilla a la silla técnica correcta',
    guide: { sets: 2, reps: 12, sides: false },
  },
  {
    id: 'stepup',
    name: 'Subida al escalón',
    dose: '2 series de 10 por pierna',
    why: 'La fuerza exacta de subir una cuesta.',
    steps: [
      'Usá un escalón bajo (el primero de la escalera) y agarrate de la baranda.',
      'Apoyá el pie entero arriba.',
      'Subí empujando con la pierna de arriba, sin impulsarte con la de abajo.',
      'Bajá despacio con la misma pierna y repetí; después cambiá de pierna.',
    ],
    careful: [
      'La rodilla de arriba alineada con el pie, sin irse hacia adentro.',
      'Todo el pie sobre el escalón, no solo la punta.',
      'La bajada lenta y controlada es la mitad del ejercicio.',
    ],
    easier: 'Un escalón más bajo (o una tarima), siempre agarrada.',
    video: 'subir escalón step up ejercicio técnica',
    guide: { sets: 2, reps: 10, sides: true },
  },
  {
    id: 'lunge',
    name: 'Estocada hacia atrás',
    dose: '2 series de 8 por pierna',
    why: 'Piernas una por una, y estabilidad de rodilla para bajadas.',
    steps: [
      'De pie, da un paso largo hacia atrás.',
      'Bajá doblando las dos rodillas hasta que la de atrás quede cerca del piso.',
      'Volvé empujando con el talón de la pierna de adelante.',
    ],
    careful: [
      'La rodilla de adelante queda sobre el tobillo y no se va hacia adentro.',
      'Torso derecho; no golpees la rodilla de atrás contra el piso.',
      'Si molesta la rodilla, bajá menos.',
    ],
    easier: 'Con una mano en la pared o en el respaldo de una silla, y bajando poco.',
    video: 'estocada hacia atrás técnica correcta',
    guide: { sets: 2, reps: 8, sides: true },
  },
  {
    id: 'calf',
    name: 'Elevación de talones en el escalón',
    dose: '2 series de 15',
    why: 'Gemelos y tendón de Aquiles para kilómetros y bajadas.',
    steps: [
      'Pará con la punta de los pies en el borde de un escalón, agarrada a la baranda.',
      'Subí en puntas de pie lo más alto que puedas.',
      'Bajá lento hasta que los talones queden un poco por debajo del escalón.',
    ],
    careful: [
      'Lento: 3 segundos para bajar, sin rebotar.',
      'Si te duele el tendón de Aquiles, hacelo en el piso plano.',
    ],
    easier: 'En el piso plano, con las dos manos en la pared.',
    video: 'elevación de talones en escalón técnica',
    guide: { sets: 2, reps: 15, sides: false },
  },
  {
    id: 'balance',
    name: 'Equilibrio en un pie',
    dose: '30 segundos por pierna',
    why: 'Tobillos firmes en senderos con piedras y raíces.',
    steps: [
      'Ponete cerca de una pared o mesa.',
      'Pará en un pie, con la rodilla apenas flexionada, mirando un punto fijo.',
      'Cuando sea fácil: cerrá los ojos, o hacelo sobre un almohadón.',
    ],
    careful: ['Siempre con algo cerca para agarrarte.'],
    easier: 'Con un dedo apoyado en la pared.',
    video: 'ejercicio equilibrio en un pie tobillo propiocepción',
    guide: { sets: 1, seconds: 30, sides: true },
  },
  {
    id: 'sideplank',
    name: 'Plancha lateral',
    dose: '20–30 segundos por lado',
    why: 'Cintura firme para cargar la mochila.',
    steps: [
      'Acostate de costado con el codo justo debajo del hombro.',
      'Rodillas dobladas (versión fácil) o piernas estiradas.',
      'Levantá la cadera hasta que el cuerpo quede en línea recta, y sostené respirando.',
    ],
    careful: [
      'El codo justo debajo del hombro.',
      'Que la cadera no se hunda.',
      'Si molesta el hombro, pará.',
    ],
    easier: 'Con las rodillas apoyadas y menos tiempo (10–15 s).',
    video: 'plancha lateral con rodillas apoyadas técnica',
    guide: { sets: 1, seconds: 25, sides: true },
  },
  {
    id: 'stretch',
    name: 'Estiramientos: cadera y gemelo',
    dose: '30 segundos de cada lado',
    why: 'Soltar lo que más trabaja al caminar.',
    steps: [
      'Cadera: una rodilla en el piso (sobre un almohadón) y la otra pierna adelante en ángulo recto. Apretá la cola y llevá la cadera apenas hacia adelante hasta sentir el estiramiento adelante del muslo de atrás.',
      'Gemelo: manos en la pared, una pierna estirada atrás con el talón en el piso; inclinate hacia la pared.',
    ],
    careful: ['Tensión suave, sin rebotes; nunca dolor.'],
    easier: 'Menos profundidad: con sentir un poco alcanza.',
    video: 'estiramiento flexor de cadera de rodillas y gemelo en la pared',
    guide: { sets: 2, seconds: 30, sides: true },
  },
];

/** Opens YouTube's search for the exercise (the app, if installed). */
export const videoUrl = (e: Exercise) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(e.video)}`;

export const SAFETY_NOTE =
  'Si sentís dolor punzante, en una articulación, o que sigue al otro día, pará. Con una lesión previa, consultá antes con un kinesiólogo. Ante dudas de técnica, preguntale al coach.';

/** Days this week with the session ticked off. */
export function strengthDaysIn(days: DateKey[], monday: DateKey): DateKey[] {
  const end = addDays(monday, 6);
  return days.filter((d) => d >= monday && d <= end);
}

/** The routine as the watch needs it (sent with the Tile data). */
export function watchRoutine() {
  return STRENGTH_ROUTINE.map((e) => ({
    id: e.id,
    name: e.name,
    cue: e.careful[0],
    easier: e.easier,
    ...e.guide,
  }));
}
