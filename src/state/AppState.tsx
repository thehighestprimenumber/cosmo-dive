import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';
import { loadSettings, loadWeekPlan, saveSettings, saveWeekPlan } from '../data/db';
import { moveSession, normalizePlan } from '../domain/plan';
import { toDateKey } from '../domain/dates';
import type { DateKey, RegularKind, Settings } from '../domain/types';
import { scheduleMorning, setupNotifications } from '../services/notifications';
import { refresh as runRefresh, type Snapshot } from '../services/sync';
import { afterSync } from '../services/afterSync';
import { registerBackgroundSync } from '../services/backgroundSync';
import { workCalendarFor } from '../services/calendar';
import type { SourceStatus } from '../sources/ActivitySource';
import { sourceFor } from '../sources';

type Ctx = {
  settings: Settings | null;
  snapshot: Snapshot | null;
  sourceStatus: SourceStatus | null;
  syncing: boolean;
  error: string | null;
  refresh: (opts?: { fullRebuild?: boolean; regenerateToday?: boolean; todayKind?: RegularKind }) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
  /** Move a key session to another free day of its week, then re-sync. */
  moveKeySession: (week: DateKey, id: string, to: DateKey) => Promise<void>;
  /** "My period started today": recorded on the phone, re-plans the light week. */
  logPeriodStart: () => Promise<void>;
  /** Re-reads settings from the database (e.g. after an import) and rebuilds history. */
  reloadAll: () => Promise<void>;
  /** Asks for data source permission; returns true when ready. */
  connect: (dataSource?: Settings['dataSource']) => Promise<boolean>;
};

const AppStateContext = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);

  const doRefresh = useCallback(
    async (opts: { fullRebuild?: boolean; regenerateToday?: boolean; todayKind?: RegularKind } = {}) => {
      const s = settingsRef.current;
      if (!s?.onboarded) return;
      if (inFlight.current) return inFlight.current;
      const run = (async () => {
        setSyncing(true);
        setError(null);
        try {
          const source = sourceFor(s);
          const status = await source.status();
          setSourceStatus(status);
          if (status.state !== 'ready') return;
          const snap = await runRefresh(db, source, s, { ...opts, calendar: workCalendarFor(s) });
          setSnapshot(snap);
          snapshotRef.current = snap;
          await afterSync(db, s, snap, { inBackground: false }).catch(() => {});
          await registerBackgroundSync().catch(() => {});
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setSyncing(false);
          inFlight.current = null;
        }
      })();
      inFlight.current = run;
      return run;
    },
    [db],
  );

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      await saveSettings(db, patch);
      const next = { ...(settingsRef.current ?? (await loadSettings(db, toDateKey(new Date())))), ...patch };
      settingsRef.current = next;
      setSettings(next);
      if (next.onboarded && ('morningReminder' in patch || 'onboarded' in patch)) {
        await scheduleMorning(next).catch(() => {});
      }
      return next;
    },
    [db],
  );

  const connect = useCallback(
    async (dataSource?: Settings['dataSource']) => {
      const s = dataSource ? await updateSettings({ dataSource }) : settingsRef.current;
      if (!s) return false;
      const source = sourceFor(s);
      try {
        const status = await source.status();
        if (status.state === 'unavailable') {
          setSourceStatus(status);
          return false;
        }
        const ok = status.state === 'ready' || (await source.requestAccess());
        setSourceStatus(ok ? { state: 'ready' } : { state: 'needs_permission' });
        return ok;
      } catch (e) {
        setSourceStatus({ state: 'unavailable', reason: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [updateSettings],
  );

  const moveKeySession = useCallback(
    async (week: DateKey, id: string, to: DateKey) => {
      const saved = await loadWeekPlan(db, week);
      if (!saved) return;
      const plan = normalizePlan(saved);
      const today = toDateKey(new Date());
      const todayDone = !!snapshotRef.current?.todayProgress?.done;
      const next = moveSession(plan, id, to, today, todayDone, true);
      if (next === plan) return;
      await saveWeekPlan(db, next);
      // If today's goal no longer matches the plan, sync replaces it (unless already done).
      await doRefresh();
    },
    [db, doRefresh],
  );

  const logPeriodStart = useCallback(async () => {
    const today = toDateKey(new Date());
    const starts = settingsRef.current?.periodStarts ?? [];
    if (starts.includes(today)) return;
    await updateSettings({ periodStarts: [...starts, today].slice(-24) });
    // Next weeks' light week follows; this week's km is recomputed too.
    await doRefresh({ regenerateToday: true });
  }, [updateSettings, doRefresh]);

  const reloadAll = useCallback(async () => {
    const s = await loadSettings(db, toDateKey(new Date()));
    settingsRef.current = s;
    setSettings(s);
    await doRefresh({ fullRebuild: true });
  }, [db, doRefresh]);

  // Initial load.
  useEffect(() => {
    (async () => {
      const s = await loadSettings(db, toDateKey(new Date()));
      settingsRef.current = s;
      setSettings(s);
      if (s.onboarded) {
        await setupNotifications().catch(() => false);
        await doRefresh();
      }
    })();
  }, [db, doRefresh]);

  // Re-sync whenever the app comes back to the foreground.
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (state) => {
      if (state === 'active') doRefresh();
    });
    return () => sub.remove();
  }, [doRefresh]);

  return (
    <AppStateContext.Provider
      value={{
        settings,
        snapshot,
        sourceStatus,
        syncing,
        error,
        refresh: doRefresh,
        updateSettings,
        moveKeySession,
        logPeriodStart,
        reloadAll,
        connect,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useApp(): Ctx {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}
