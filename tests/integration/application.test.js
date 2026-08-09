import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApplication } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/database.js';

function setup(overrides = {}) {
  let clock = Date.now();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    COOKIE_SECRET: 'test-cookie-secret-that-is-at-least-thirty-two-characters',
    COOKIE_SECURE: 'false',
    REPORT_TTL_MS: '300000',
    ...overrides
  });
  const database = openDatabase(':memory:');
  const application = createApplication({
    config,
    database,
    now: () => clock,
    startTimers: false
  });

  return {
    ...application,
    database,
    setClock(value) {
      clock = value;
    },
    destroy() {
      application.close();
      database.close();
    }
  };
}

test('renders the mobile app, health check, and local vendor assets', async () => {
  const system = setup();
  try {
    const page = await request(system.app).get('/').expect(200);
    assert.match(page.text, /Stranded Philippines/);
    assert.match(page.text, /noindex, nofollow/);
    assert.match(page.text, /hx-post="\/reports"/);
    assert.equal(page.headers['x-robots-tag'], 'noindex, nofollow');
    assert.match(page.headers['set-cookie'][0], /HttpOnly/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    assert.doesNotMatch(
      page.headers['content-security-policy'],
      /upgrade-insecure-requests/
    );

    await request(system.app).get('/healthz').expect(200, { status: 'ok' });
    await request(system.app).get('/vendor/htmx/htmx.min.js').expect(200);
    await request(system.app).get('/vendor/leaflet/leaflet.js').expect(200);
    await request(system.app)
      .get('/vendor/leaflet-heat/leaflet-heat.js')
      .expect(200);
  } finally {
    system.destroy();
  }
});

test('creates, refreshes, and owner-resolves an anonymous report', async () => {
  const system = setup();
  const owner = request.agent(system.app);
  const stranger = request.agent(system.app);

  try {
    await owner.get('/').expect(200);
    const created = await owner
      .post('/reports')
      .type('form')
      .send({ type: 'self', latitude: '14.5995', longitude: '120.9842' })
      .expect(200);
    assert.match(created.text, /active-report-state/);
    assert.doesNotMatch(created.text, /Report added to the heat map/);
    assert.match(created.headers['hx-trigger'], /reportSaved/);

    const id = system.database.raw.prepare('SELECT id FROM reports').get().id;
    const refreshed = await owner
      .post('/reports')
      .type('form')
      .send({ type: 'witness', latitude: '14.5995', longitude: '120.9842' })
      .expect(200);
    assert.match(refreshed.text, /active-report-state/);
    assert.doesNotMatch(refreshed.text, /Existing nearby report refreshed/);
    assert.equal(system.database.raw.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 1);

    await stranger.get('/').expect(200);
    await stranger.post(`/reports/${id}/resolve`).expect(404);
    await owner.post(`/reports/${id}/resolve`).expect(200);
    assert.equal(system.database.raw.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 0);
  } finally {
    system.destroy();
  }
});

test('rejects malformed reports and cross-origin mutations', async () => {
  const system = setup();
  try {
    await request(system.app)
      .post('/reports')
      .type('form')
      .send({ type: 'unknown', latitude: '999', longitude: 'x' })
      .expect(422);

    await request(system.app)
      .post('/reports')
      .type('form')
      .send({ type: 'self', latitude: '35.6762', longitude: '139.6503' })
      .expect(422);

    await request(system.app)
      .post('/reports')
      .set('Origin', 'https://attacker.example')
      .type('form')
      .send({ type: 'self', latitude: '14', longitude: '121' })
      .expect(403);
  } finally {
    system.destroy();
  }
});

test('allows the configured static frontend and preserves header-token ownership', async () => {
  const frontendOrigin = 'https://example.github.io';
  const deviceToken = 'a'.repeat(43);
  const system = setup({ FRONTEND_ORIGINS: frontendOrigin });

  try {
    const preflight = await request(system.app)
      .options('/reports')
      .set('Origin', frontendOrigin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'HX-Request, X-Device-Token')
      .expect(204);
    assert.equal(preflight.headers['access-control-allow-origin'], frontendOrigin);
    assert.match(preflight.headers['access-control-allow-headers'], /X-Device-Token/);

    const created = await request(system.app)
      .post('/reports')
      .set('Origin', frontendOrigin)
      .set('X-Device-Token', deviceToken)
      .type('form')
      .send({ type: 'self', latitude: '14.5995', longitude: '120.9842' })
      .expect(200);
    assert.equal(created.headers['access-control-allow-origin'], frontendOrigin);
    assert.equal(created.headers['set-cookie'], undefined);

    const mine = await request(system.app)
      .get('/reports/mine')
      .set('Origin', frontendOrigin)
      .set('X-Device-Token', deviceToken)
      .expect(200);
    assert.match(mine.text, /active-report-state/);
  } finally {
    system.destroy();
  }
});

test('enforces device submission limits', async () => {
  const system = setup();
  const owner = request.agent(system.app);
  const started = Date.now();
  system.setClock(started);
  try {
    await owner.get('/').expect(200);
    for (let index = 0; index < 3; index += 1) {
      await owner
        .post('/reports')
        .type('form')
        .send({
          type: 'witness',
          latitude: String(10 + index),
          longitude: '120'
        })
        .expect(200);
    }

    const limited = await owner
      .post('/reports')
      .type('form')
      .send({ type: 'witness', latitude: '20', longitude: '120' })
      .expect(429);
    assert.match(limited.headers['retry-after'], /^\d+$/);
    assert.match(limited.headers['hx-trigger'], /reportLimited/);
    assert.equal(limited.text, '');

    system.setClock(started + 4_999);
    await owner
      .post('/reports')
      .type('form')
      .send({ type: 'witness', latitude: '20', longitude: '120' })
      .expect(429);

    const reportToResolve = system.database.raw
      .prepare('SELECT id FROM reports LIMIT 1')
      .get();
    await owner.post(`/reports/${reportToResolve.id}/resolve`).expect(200);

    system.setClock(started + 5_000);
    await owner
      .post('/reports')
      .type('form')
      .send({ type: 'witness', latitude: '20', longitude: '120' })
      .expect(200);
  } finally {
    system.destroy();
  }
});

test('expiry sweep deletes exact coordinates and removes heat cells', async () => {
  const system = setup();
  const owner = request.agent(system.app);
  const started = Date.now();
  system.setClock(started);

  try {
    await owner.get('/').expect(200);
    await owner
      .post('/reports')
      .type('form')
      .send({ type: 'self', latitude: '14.5995', longitude: '120.9842' })
      .expect(200);

    system.setClock(started + 300_001);
    assert.equal(system.sweep(), 1);
    assert.equal(system.database.raw.prepare('SELECT COUNT(*) AS count FROM reports').get().count, 0);
  } finally {
    system.destroy();
  }
});

test('SSE snapshot exposes exact locations without report or device identifiers', async () => {
  const system = setup();
  const owner = request.agent(system.app);
  const otherDevice = request.agent(system.app);
  const server = system.app.listen(0);

  try {
    await owner.get('/').expect(200);
    await owner
      .post('/reports')
      .type('form')
      .send({ type: 'self', latitude: '14.5995', longitude: '120.9842' })
      .expect(200);
    await otherDevice.get('/').expect(200);
    await otherDevice
      .post('/reports')
      .type('form')
      .send({ type: 'self', latitude: '14.5996', longitude: '120.9843' })
      .expect(200);

    const { port } = server.address();
    const response = await fetch(
      `http://127.0.0.1:${port}/events?bbox=120,14,122,16`
    );
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const chunk = new TextDecoder().decode(value);
    const dataLine = chunk.split('\n').find((line) => line.startsWith('data: '));
    const snapshot = JSON.parse(dataLine.slice(6));

    assert.equal(snapshot.cells.length, 2);
    assert.deepEqual(
      snapshot.cells.map(({ latitude, longitude, count }) => ({
        latitude,
        longitude,
        count
      })),
      [
        { latitude: 14.5995, longitude: 120.9842, count: 1 },
        { latitude: 14.5996, longitude: 120.9843, count: 1 }
      ]
    );
    assert.equal(chunk.includes('device_hash'), false);
    assert.equal(chunk.includes('report_type'), false);
    assert.equal(chunk.includes('"id"'), false);

    const outside = system.database.heatCells(
      { west: -10, south: -10, east: 10, north: 10 },
      Date.now()
    );
    assert.deepEqual(outside, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    system.destroy();
  }
});

test('history endpoint returns heatmap state for the selected time', async () => {
  const system = setup();
  const owner = request.agent(system.app);
  const started = Date.now();
  const bbox = '120,14,122,16';

  try {
    system.setClock(started);
    await owner.get('/').expect(200);
    await owner
      .post('/reports')
      .type('form')
      .send({ type: 'self', latitude: '14.5995', longitude: '120.9842' })
      .expect(200);

    system.setClock(started + 360_000);
    system.sweep();

    const historical = await request(system.app)
      .get(`/history?bbox=${bbox}&at=${started + 60_000}`)
      .expect(200);
    assert.equal(historical.body.cells.length, 1);
    assert.equal(historical.body.cells[0].count, 1);
    assert.equal(historical.body.observedAt, started + 60_000);

    const current = await request(system.app)
      .get(`/history?bbox=${bbox}&at=${started + 360_000}`)
      .expect(200);
    assert.deepEqual(current.body.cells, []);

    await request(system.app)
      .get(`/history?bbox=${bbox}&at=${started - 3 * 60 * 60 * 1000 - 1}`)
      .expect(400);
  } finally {
    system.destroy();
  }
});
