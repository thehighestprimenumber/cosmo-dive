import { addDays } from './dates';
import type { DateKey } from './types';

/**
 * Strength & mobility for trekking: 10 minutes, twice a week, any days you
 * like. You tick it off (the watch can't tell). Worth XP, never your streak.
 */
export const STRENGTH_PER_WEEK = 2;
export const STRENGTH_XP = 5;

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
