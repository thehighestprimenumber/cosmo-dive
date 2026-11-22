import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import type { WeekPlan } from './plan';
import { parseForecast, weatherIssue, weatherSuggestions, type DayForecast } from './weather';

const MON = '2026-11-23';
const fine = (date: string): DayForecast => ({ date, rainChance: 10, rainMm: 0, tempMax: 24, windMax: 15 });
const plan: WeekPlan = {
  week: MON,
  sessions: [
    { id: 'long', kind: 'long_walk', day: addDays(MON, 5), plannedDay: addDays(MON, 5) },
    { id: 'brisk', kind: 'brisk_walk', day: addDays(MON, 2), plannedDay: addDays(MON, 2) },
  ],
};

describe('weather', () => {
  it('flags heavy rain, heat and strong wind, not a drizzle', () => {
    expect(weatherIssue({ ...fine(MON), rainChance: 80, rainMm: 6 })).toBe('rain');
    expect(weatherIssue({ ...fine(MON), rainChance: 80, rainMm: 0.5 })).toBeNull();
    expect(weatherIssue({ ...fine(MON), tempMax: 34 })).toBe('heat');
    expect(weatherIssue({ ...fine(MON), windMax: 60 })).toBe('wind');
  });

  it('suggests the nearest fine free day for a long walk on a rainy day', () => {
    const forecast = Array.from({ length: 7 }, (_, i) => fine(addDays(MON, i)));
    forecast[5] = { ...forecast[5], rainChance: 90, rainMm: 12 }; // Saturday
    const [s] = weatherSuggestions([plan], forecast, MON, false);
    expect(s).toMatchObject({ sessionId: 'long', from: addDays(MON, 5), to: addDays(MON, 4), why: '90% chance of rain (12 mm)' });
    // Not onto a work day, and not if every other day is bad too.
    expect(weatherSuggestions([plan], forecast, MON, false, [addDays(MON, 4)])[0].to).toBe(addDays(MON, 6));
    const allBad = forecast.map((f) => ({ ...f, tempMax: 36 }));
    expect(weatherSuggestions([plan], allBad, MON, false)).toEqual([]);
    // Past days and days without a forecast are left alone.
    expect(weatherSuggestions([plan], forecast, addDays(MON, 6), false)).toEqual([]);
  });

  it('reads Open-Meteo daily arrays', () => {
    const f = parseForecast({
      daily: {
        time: [MON],
        precipitation_probability_max: [75],
        precipitation_sum: [3.2],
        temperature_2m_max: [27.5],
        wind_speed_10m_max: [20],
      },
    });
    expect(f).toEqual([{ date: MON, rainChance: 75, rainMm: 3.2, tempMax: 27.5, windMax: 20 }]);
    expect(parseForecast({})).toEqual([]);
  });
});
