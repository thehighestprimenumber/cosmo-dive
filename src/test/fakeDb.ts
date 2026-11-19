/// <reference types="node" />
import type { SQLiteDatabase } from 'expo-sqlite';
import { DatabaseSync } from 'node:sqlite';

/** Just enough of expo-sqlite's async API, backed by Node's built-in SQLite. */
export function fakeDb(): SQLiteDatabase {
  const db = new DatabaseSync(':memory:');
  const flat = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
  const api = {
    execAsync: async (sql: string) => db.exec(sql),
    runAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).run(...(flat(p) as never[])),
    getAllAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(flat(p) as never[])),
    getFirstAsync: async (sql: string, ...p: unknown[]) => db.prepare(sql).get(...(flat(p) as never[])) ?? null,
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}
