import type { Activity } from '../domain/types';

export type SourceStatus =
  | { state: 'ready' }
  | { state: 'needs_permission' }
  | { state: 'unavailable'; reason: string };

/**
 * Where walks and rides come from. Goals, streaks and the calendar only see
 * `Activity`, so another source (e.g. Strava) can be added later.
 */
export interface ActivitySource {
  readonly name: string;
  status(): Promise<SourceStatus>;
  /** Shows the permission prompt. Resolves true if everything needed was granted. */
  requestAccess(): Promise<boolean>;
  /** Walks and rides that started in [from, to), with heart rate samples attached. */
  getActivities(from: Date, to: Date): Promise<Activity[]>;
}
