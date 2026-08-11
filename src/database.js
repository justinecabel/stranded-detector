import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { projectToGrid } from './geo.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    report_type TEXT NOT NULL CHECK (report_type IN ('self', 'witness')),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    grid_x INTEGER NOT NULL,
    grid_y INTEGER NOT NULL,
    device_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reports_expiry ON reports(expires_at);
  CREATE INDEX IF NOT EXISTS idx_reports_device ON reports(device_hash, expires_at);
  CREATE INDEX IF NOT EXISTS idx_reports_grid ON reports(grid_x, grid_y, expires_at);
  CREATE INDEX IF NOT EXISTS idx_reports_bounds ON reports(latitude, longitude, expires_at);

  CREATE TABLE IF NOT EXISTS report_history (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    report_type TEXT NOT NULL CHECK (report_type IN ('self', 'witness')),
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    grid_x INTEGER NOT NULL,
    grid_y INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_history_time ON report_history(started_at, ended_at);
  CREATE INDEX IF NOT EXISTS idx_history_bounds ON report_history(latitude, longitude, started_at, ended_at);
`;

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');

  const migrate = db.transaction(() => {
    db.exec(SCHEMA);
    const migration = db
      .prepare('SELECT version FROM schema_migrations WHERE version = 1')
      .get();
    if (!migration) {
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)'
      ).run(Date.now());
    }
  });
  migrate();

  const statements = {
    insert: db.prepare(`
      INSERT INTO reports (
        id, report_type, latitude, longitude, grid_x, grid_y,
        device_hash, created_at, expires_at
      ) VALUES (
        @id, @reportType, @latitude, @longitude, @gridX, @gridY,
        @deviceHash, @createdAt, @expiresAt
      )
    `),
    findDuplicate: db.prepare(`
      SELECT * FROM reports
      WHERE device_hash = ? AND grid_x = ? AND grid_y = ? AND expires_at > ?
      LIMIT 1
    `),
    refresh: db.prepare(`
      UPDATE reports
      SET report_type = @reportType,
          latitude = @latitude,
          longitude = @longitude,
          created_at = @createdAt,
          expires_at = @expiresAt
      WHERE id = @id
    `),
    insertHistory: db.prepare(`
      INSERT INTO report_history (
        id, report_id, report_type, latitude, longitude,
        grid_x, grid_y, started_at, ended_at
      ) VALUES (
        @id, @reportId, @reportType, @latitude, @longitude,
        @gridX, @gridY, @startedAt, @endedAt
      )
    `),
    closeHistory: db.prepare(`
      UPDATE report_history
      SET ended_at = @endedAt
      WHERE report_id = @reportId AND ended_at IS NULL
    `),
    activeByDevice: db.prepare(`
      SELECT id, report_type, created_at, expires_at
      FROM reports
      WHERE device_hash = ? AND expires_at > ?
      ORDER BY expires_at ASC
    `),
    activeCountByDevice: db.prepare(`
      SELECT COUNT(*) AS count
      FROM reports
      WHERE device_hash = ? AND expires_at > ?
    `),
    deleteOwned: db.prepare('DELETE FROM reports WHERE id = ? AND device_hash = ?'),
    deleteExpired: db.prepare('DELETE FROM reports WHERE expires_at <= ?'),
    expiredReports: db.prepare(`
      SELECT id, expires_at
      FROM reports
      WHERE expires_at <= ?
    `),
    deleteHistoryBefore: db.prepare(`
      DELETE FROM report_history
      WHERE ended_at IS NOT NULL AND ended_at <= ?
    `),
    locationsInBounds: db.prepare(`
      SELECT latitude, longitude, COUNT(*) AS count
      FROM reports
      WHERE expires_at > @now
        AND longitude >= @west
        AND longitude <= @east
        AND latitude >= @south
        AND latitude <= @north
      GROUP BY latitude, longitude
      ORDER BY latitude, longitude
    `),
    historyLocationsInBounds: db.prepare(`
      SELECT latitude, longitude, COUNT(*) AS count
      FROM report_history
      WHERE started_at <= @at
        AND (ended_at IS NULL OR ended_at > @at)
        AND longitude >= @west
        AND longitude <= @east
        AND latitude >= @south
        AND latitude <= @north
      GROUP BY latitude, longitude
      ORDER BY latitude, longitude
    `),
    historyIntervalsInBounds: db.prepare(`
      SELECT
        latitude,
        longitude,
        started_at AS startedAt,
        ended_at AS endedAt
      FROM report_history
      WHERE started_at <= @to
        AND (ended_at IS NULL OR ended_at > @from)
        AND longitude >= @west
        AND longitude <= @east
        AND latitude >= @south
        AND latitude <= @north
      ORDER BY latitude, longitude, started_at
    `),
    health: db.prepare('SELECT 1 AS healthy')
  };

  const upsertReport = db.transaction(
    ({ reportType, latitude, longitude, deviceHash, now, ttlMs }) => {
      const { gridX, gridY } = projectToGrid(latitude, longitude);
      const expiresAt = now + ttlMs;
      const duplicate = statements.findDuplicate.get(deviceHash, gridX, gridY, now);

      if (duplicate) {
        statements.closeHistory.run({ reportId: duplicate.id, endedAt: now });
        const refreshed = {
          id: duplicate.id,
          reportType,
          latitude,
          longitude,
          createdAt: now,
          expiresAt
        };
        statements.refresh.run(refreshed);
        statements.insertHistory.run({
          id: crypto.randomUUID(),
          reportId: duplicate.id,
          reportType,
          latitude,
          longitude,
          gridX,
          gridY,
          startedAt: now,
          endedAt: null
        });
        return { id: duplicate.id, expiresAt, refreshed: true };
      }

      const active = statements.activeCountByDevice.get(deviceHash, now).count;
      if (active >= 3) {
        const error = new Error('A device may have at most three active locations');
        error.code = 'ACTIVE_REPORT_LIMIT';
        throw error;
      }

      const report = {
        id: crypto.randomUUID(),
        reportType,
        latitude,
        longitude,
        gridX,
        gridY,
        deviceHash,
        createdAt: now,
        expiresAt
      };
      statements.insert.run(report);
      statements.insertHistory.run({
        id: crypto.randomUUID(),
        reportId: report.id,
        reportType,
        latitude,
        longitude,
        gridX,
        gridY,
        startedAt: now,
        endedAt: null
      });
      return { id: report.id, expiresAt, refreshed: false };
    }
  );

  const deleteExpired = db.transaction((now) => {
    for (const report of statements.expiredReports.all(now)) {
      statements.closeHistory.run({
        reportId: report.id,
        endedAt: report.expires_at
      });
    }
    return statements.deleteExpired.run(now).changes;
  });

  return {
    raw: db,
    upsertReport,
    activeReportsForDevice(deviceHash, now = Date.now()) {
      return statements.activeByDevice.all(deviceHash, now);
    },
    resolveReport(id, deviceHash, now = Date.now()) {
      const resolved = statements.deleteOwned.run(id, deviceHash).changes > 0;
      if (resolved) statements.closeHistory.run({ reportId: id, endedAt: now });
      return resolved;
    },
    deleteExpired(now = Date.now()) {
      return deleteExpired(now);
    },
    pruneHistory(before = Date.now()) {
      return statements.deleteHistoryBefore.run(before).changes;
    },
    heatCells(bbox, now = Date.now()) {
      return statements.locationsInBounds.all({ ...bbox, now });
    },
    historyCells(bbox, at = Date.now()) {
      return statements.historyLocationsInBounds.all({ ...bbox, at });
    },
    historyTimeline(bbox, from, to, stepMs) {
      const intervals = statements.historyIntervalsInBounds.all({ ...bbox, from, to });
      const snapshots = [];

      for (let observedAt = to; observedAt >= from; observedAt -= stepMs) {
        const locations = new Map();
        for (const interval of intervals) {
          if (
            interval.startedAt > observedAt ||
            (interval.endedAt !== null && interval.endedAt <= observedAt)
          ) continue;

          const key = `${interval.latitude}:${interval.longitude}`;
          const existing = locations.get(key);
          if (existing) existing.count += 1;
          else locations.set(key, {
            latitude: interval.latitude,
            longitude: interval.longitude,
            count: 1
          });
        }
        snapshots.push({ observedAt, cells: Array.from(locations.values()) });
      }

      return snapshots;
    },
    isHealthy() {
      return statements.health.get().healthy === 1;
    },
    close() {
      db.close();
    }
  };
}
