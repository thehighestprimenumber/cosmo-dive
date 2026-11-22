import type { SQLiteDatabase } from 'expo-sqlite';
import { parseForecast, type DayForecast } from '../domain/weather';
import type { Settings } from '../domain/types';

/**
 * Weather from Open-Meteo (free, no account or key). Only your town's
 * coordinates are sent; the forecast is cached for 3 hours.
 */
export type Place = { name: string; lat: number; lon: number };
export type WeatherSource = { forecast(): Promise<DayForecast[]> };

const CACHE_MS = 3 * 3_600_000;

export async function findPlaces(query: string, fetchImpl: typeof fetch = fetch): Promise<Place[]> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=5&language=es&name=${encodeURIComponent(query.trim())}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Place search failed (${res.status}).`);
  const json = (await res.json()) as { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
  return (json.results ?? []).map((r) => ({
    name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 100) / 100,
    lon: Math.round(r.longitude * 100) / 100,
  }));
}

export function weatherFor(db: SQLiteDatabase, settings: Settings, fetchImpl: typeof fetch = fetch): WeatherSource | null {
  const place = settings.weatherPlace;
  if (!place) return null;
  return {
    async forecast() {
      const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'weatherCache'");
      const cache = row ? (JSON.parse(row.value) as { at: number; lat: number; lon: number; days: DayForecast[] }) : null;
      if (cache && cache.lat === place.lat && cache.lon === place.lon && Date.now() - cache.at < CACHE_MS) return cache.days;
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
        '&daily=precipitation_probability_max,precipitation_sum,temperature_2m_max,wind_speed_10m_max&timezone=auto&forecast_days=10';
      const res = await fetchImpl(url);
      if (!res.ok) return cache?.days ?? [];
      const days = parseForecast(await res.json());
      await db.runAsync(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        'weatherCache',
        JSON.stringify({ at: Date.now(), lat: place.lat, lon: place.lon, days }),
      );
      return days;
    },
  };
}
