import { daysBetween } from './dates';
import { freeDays, isMovable, type SessionKind, type WeekPlan } from './plan';
import type { DateKey } from './types';

/** One day of the forecast (Open-Meteo daily values). */
export type DayForecast = {
  date: DateKey;
  rainChance: number; // %, max of the day
  rainMm: number;
  tempMax: number; // °C
  windMax: number; // km/h
};

export type WeatherIssue = 'rain' | 'heat' | 'wind';

/** Rain likely and real (70%+ and 2+ mm), 33 °C or more, or 50+ km/h wind. */
export function weatherIssue(f: DayForecast): WeatherIssue | null {
  if (f.rainChance >= 70 && f.rainMm >= 2) return 'rain';
  if (f.tempMax >= 33) return 'heat';
  if (f.windMax >= 50) return 'wind';
  return null;
}

export const ISSUE_TEXT: Record<WeatherIssue, (f: DayForecast) => string> = {
  rain: (f) => `${f.rainChance}% chance of rain (${Math.round(f.rainMm)} mm)`,
  heat: (f) => `${Math.round(f.tempMax)} °C`,
  wind: (f) => `wind up to ${Math.round(f.windMax)} km/h`,
};

export function weatherEmoji(f: DayForecast): string {
  const issue = weatherIssue(f);
  if (issue === 'rain') return '🌧️';
  if (issue === 'heat') return '🥵';
  if (issue === 'wind') return '💨';
  if (f.rainChance >= 40) return '🌦️';
  return f.tempMax >= 26 ? '☀️' : '⛅';
}

export type WeatherSuggestion = {
  /** Stable key, so "Not now" is remembered. */
  key: string;
  week: DateKey;
  sessionId: string;
  kind: SessionKind;
  from: DateKey;
  to: DateKey;
  why: string;
  better: string;
};

/**
 * A long or brisk walk on a day with bad weather ahead: suggest the nearest
 * free day of the same week with fine weather (not a work day, 2+ days from
 * the other sessions if possible). Back-to-back pairs and trek days stay.
 */
export function weatherSuggestions(
  plans: (WeekPlan | null)[],
  forecast: DayForecast[],
  today: DateKey,
  todayDone: boolean,
  busy: DateKey[] = [],
): WeatherSuggestion[] {
  const byDay = new Map(forecast.map((f) => [f.date, f]));
  const out: WeatherSuggestion[] = [];
  for (const plan of plans) {
    if (!plan || plan.sessions.some((s) => s.kind === 'back_to_back' && !s.dropped)) continue;
    for (const s of plan.sessions) {
      if (s.dropped || !isMovable(s) || (s.kind !== 'long_walk' && s.kind !== 'brisk_walk')) continue;
      if (s.day < today || (s.day === today && todayDone)) continue;
      const f = byDay.get(s.day);
      const issue = f && weatherIssue(f);
      if (!f || !issue) continue;
      const others = plan.sessions.filter((x) => x.id !== s.id && !x.dropped).map((x) => x.day);
      const options = freeDays(plan, today, todayDone, s.id).filter((d) => {
        const g = byDay.get(d);
        return g && !weatherIssue(g) && !busy.includes(d);
      });
      if (!options.length) continue;
      const gapOk = (d: DateKey) => others.every((o) => Math.abs(daysBetween(o, d)) >= 2);
      const near = (d: DateKey) => Math.abs(daysBetween(s.day, d));
      const to = [...options].sort((a, b) => Number(gapOk(b)) - Number(gapOk(a)) || near(a) - near(b) || (a < b ? -1 : 1))[0];
      const g = byDay.get(to)!;
      out.push({
        key: `${plan.week}:${s.id}:${s.day}:${issue}`,
        week: plan.week,
        sessionId: s.id,
        kind: s.kind,
        from: s.day,
        to,
        why: ISSUE_TEXT[issue](f),
        better: `${g.rainChance}% rain, ${Math.round(g.tempMax)} °C`,
      });
    }
  }
  return out;
}

/** Open-Meteo's daily arrays → one object per day. */
export function parseForecast(json: unknown): DayForecast[] {
  const d = (json as { daily?: Record<string, unknown[]> })?.daily;
  if (!d || !Array.isArray(d.time)) return [];
  return d.time.map((date, i) => ({
    date: String(date),
    rainChance: Number(d.precipitation_probability_max?.[i] ?? 0),
    rainMm: Number(d.precipitation_sum?.[i] ?? 0),
    tempMax: Number(d.temperature_2m_max?.[i] ?? 0),
    windMax: Number(d.wind_speed_10m_max?.[i] ?? 0),
  }));
}
