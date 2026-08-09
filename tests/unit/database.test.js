import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../../src/database.js';

test('migrates, deduplicates, exposes exact locations, resolves, and expires reports', () => {
  const database = openDatabase(':memory:');
  const now = 1_000_000;

  try {
    const first = database.upsertReport({
      reportType: 'self',
      latitude: 14.5995,
      longitude: 120.9842,
      deviceHash: 'device-a',
      now,
      ttlMs: 300_000
    });
    const duplicate = database.upsertReport({
      reportType: 'witness',
      latitude: 14.5995,
      longitude: 120.9842,
      deviceHash: 'device-a',
      now: now + 1000,
      ttlMs: 300_000
    });
    database.upsertReport({
      reportType: 'witness',
      latitude: 14.5995,
      longitude: 120.9842,
      deviceHash: 'device-b',
      now,
      ttlMs: 300_000
    });

    assert.equal(first.refreshed, false);
    assert.equal(duplicate.refreshed, true);
    assert.equal(duplicate.id, first.id);

    const cells = database.heatCells(
      { west: 120, south: 14, east: 122, north: 16 },
      now + 2000
    );
    assert.equal(cells.length, 1);
    assert.equal(cells[0].count, 2);
    assert.equal(cells[0].latitude, 14.5995);
    assert.equal(cells[0].longitude, 120.9842);
    assert.equal(Object.hasOwn(cells[0], 'id'), false);

    assert.equal(database.resolveReport(first.id, 'device-b'), false);
    assert.equal(database.resolveReport(first.id, 'device-a'), true);
    assert.equal(database.activeReportsForDevice('device-a', now).length, 0);

    assert.equal(database.deleteExpired(now + 300_001), 1);
    assert.equal(database.heatCells(
      { west: 120, south: 14, east: 122, north: 16 },
      now + 300_001
    ).length, 0);
  } finally {
    database.close();
  }
});

test('enforces a maximum of three active locations per device', () => {
  const database = openDatabase(':memory:');
  try {
    for (let index = 0; index < 3; index += 1) {
      database.upsertReport({
        reportType: 'witness',
        latitude: 10 + index,
        longitude: 120,
        deviceHash: 'device-a',
        now: 1000,
        ttlMs: 300_000
      });
    }

    assert.throws(
      () =>
        database.upsertReport({
          reportType: 'witness',
          latitude: 20,
          longitude: 120,
          deviceHash: 'device-a',
          now: 1000,
          ttlMs: 300_000
        }),
      { code: 'ACTIVE_REPORT_LIMIT' }
    );
  } finally {
    database.close();
  }
});

test('preserves report intervals for heatmap history', () => {
  const database = openDatabase(':memory:');
  const started = 2_000_000;
  const bbox = { west: 120, south: 14, east: 122, north: 16 };

  try {
    const report = database.upsertReport({
      reportType: 'self',
      latitude: 14.5995,
      longitude: 120.9842,
      deviceHash: 'device-a',
      now: started,
      ttlMs: 300_000
    });

    assert.equal(database.historyCells(bbox, started + 60_000).length, 1);
    database.resolveReport(report.id, 'device-a', started + 120_000);
    assert.equal(database.historyCells(bbox, started + 119_999).length, 1);
    assert.equal(database.historyCells(bbox, started + 120_000).length, 0);

    const expired = database.upsertReport({
      reportType: 'witness',
      latitude: 14.6,
      longitude: 120.985,
      deviceHash: 'device-b',
      now: started + 180_000,
      ttlMs: 300_000
    });
    database.deleteExpired(started + 480_000);
    assert.equal(database.historyCells(bbox, started + 479_999).length, 1);
    assert.equal(database.historyCells(bbox, expired.expiresAt).length, 0);
  } finally {
    database.close();
  }
});
