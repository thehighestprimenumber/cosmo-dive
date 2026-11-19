import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';
import { loadSettings, saveSettings } from '../data/db';
import { toDateKey } from '../domain/dates';
import type { Settings } from '../domain/types';
import { scheduleMorning, setupNotifications, updateEvening } from '../services/notifications';
import { refresh as runRefresh, type Snapshot } from '../services/sync';
import type { ActivitySource, SourceStatus } from '../sources/ActivitySource';
import { demoSource } from '../sources/demo';
import { healthConnectSource } from '../sources/healthConnect';

export const sourceFor = (s: Pick<Settings, 'dataSource'>): ActivitySource =>
  s.dataSource === 'demo' ? demoSource : healthConnectSource;

type Ctx = {
  settings: Settings | null;
  snapshot: Snapshot | null;
  sourceStatus: SourceStatus | null;
  syncing: boolean;
  error: string | null;
  refresh: (opts?: { fullRebuild?: boolean }) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<Settings>;
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
  const inFlight = useRef<Promise<void> | null>(null);

  const doRefresh = useCallback(
    async (opts: { fullRebuild?: boolean } = {}) => {
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
          const snap = await runRefresh(db, source, s, opts);
          setSnapshot(snap);
          await updateEvening(s, snap.today, snap.todayGoal, !!snap.todayProgress?.done, snap.streak.current).catch(
            () => {},
          );
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
      value={{ settings, snapshot, sourceStatus, syncing, error, refresh: doRefresh, updateSettings, connect }}
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
