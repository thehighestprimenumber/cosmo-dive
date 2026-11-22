import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';

vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {} }));
const { backupDue, oldBackups } = await import('./autoBackup');

const s: Settings = { ...DEFAULT_SETTINGS, startDate: '2026-11-01', backupFolder: 'content://x' };
const DAY = 86_400_000;

describe('automatic backup', () => {
  it('weekly, a day after a failure, never without a folder', () => {
    expect(backupDue(s, 0)).toBe(true);
    expect(backupDue({ ...s, lastAutoBackup: { at: 0, ok: true } }, 6 * DAY)).toBe(false);
    expect(backupDue({ ...s, lastAutoBackup: { at: 0, ok: true } }, 7 * DAY)).toBe(true);
    expect(backupDue({ ...s, lastAutoBackup: { at: 0, ok: false, error: 'x' } }, DAY)).toBe(true);
    expect(backupDue({ ...s, backupFolder: null }, 99 * DAY)).toBe(false);
  });

  it('keeps the newest 8 of its own files', () => {
    const names = Array.from({ length: 10 }, (_, i) => `daily-spark-backup-2026-11-${String(i + 10)}-0900.json`);
    expect(oldBackups([...names, 'notes.txt'])).toEqual(names.slice(0, 2));
    expect(oldBackups(names.slice(0, 3))).toEqual([]);
  });
});
