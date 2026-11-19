import type { DayStatus } from '../domain/types';

export const colors = {
  bg: '#14110F',
  card: '#221D1A',
  cardBorder: '#332B26',
  text: '#F7F1EC',
  muted: '#A89C93',
  accent: '#FF7A1A', // spark orange
  accentSoft: '#4A2A14',
  done: '#3DBE6E',
  missed: '#D9534F',
  frozen: '#5BB8E8',
  bonus: '#A47CFF', // moved on a rest day
  rest: '#4B4440',
  pending: '#FFB547',
};

export const radius = 16;
export const gap = 16;

export const STATUS_COLOR: Record<DayStatus | 'future', string> = {
  done: colors.done,
  bonus: colors.bonus,
  missed: colors.missed,
  frozen: colors.frozen,
  rest: colors.rest,
  pending: colors.pending,
  none: 'transparent',
  future: colors.cardBorder,
};
