import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ensureDevice } from './device.js';
import {
  parseBbox,
  parseCoordinate,
  validatePhilippinesCoordinates
} from './geo.js';
import { SlidingWindowLimiter } from './rate-limit.js';
import { SseHub } from './sse-hub.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, '..');
const REPORT_LIMIT_COOLDOWN_MS = 5000;
const HISTORY_WINDOW_MS = 3 * 60 * 60 * 1000;

function isAllowedOrigin(req, config, origin) {
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    if (originUrl.origin === `${req.protocol}://${req.get('host')}`) return true;
    return config.frontendOrigins.includes(originUrl.origin);
  } catch {
    return false;
  }
}

function allowConfiguredFrontendOrigins(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || !isAllowedOrigin(req, config, origin)) return next();

    res.set('Access-Control-Allow-Origin', origin);
    res.vary('Origin');
    res.set(
      'Access-Control-Allow-Headers',
      [
        'Content-Type',
        'HX-Boosted',
        'HX-Current-URL',
        'HX-History-Restore-Request',
        'HX-Prompt',
        'HX-Request',
        'HX-Target',
        'HX-Trigger',
        'HX-Trigger-Name',
        'X-Device-Token'
      ].join(', ')
    );
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set(
      'Access-Control-Expose-Headers',
      'HX-Reswap, HX-Retarget, HX-Trigger, Retry-After'
    );

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

function sameOriginOnly(config) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (isAllowedOrigin(req, config, origin)) return next();

    return res.status(403).send('Cross-origin request rejected');
  };
}

function setRateLimitResponse(res, cooldownMs) {
  res.set('Retry-After', String(Math.ceil(cooldownMs / 1000)));
  res.set('HX-Reswap', 'none');
  res.set('HX-Trigger', JSON.stringify({ reportLimited: { cooldownMs } }));
}

export function createApplication({
  config,
  database,
  now = Date.now,
  startTimers = true
}) {
  const app = express();
  const hub = new SseHub({
    database,
    heartbeatMs: config.heartbeatMs,
    now
  });
  const ipLimiter = new SlidingWindowLimiter({
    limit: 10,
    windowMs: 5 * 60 * 1000,
    now
  });
  const deviceLimiter = new SlidingWindowLimiter({
    limit: 3,
    windowMs: 5 * 60 * 1000,
    now
  });

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('view engine', 'ejs');
  app.set('views', path.join(projectRoot, 'views'));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );
  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json');
    res.sendFile(path.join(projectRoot, 'public', 'manifest.webmanifest'));
  });
  app.get('/service-worker.js', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/');
    res.type('application/javascript');
    res.sendFile(path.join(projectRoot, 'public', 'service-worker.js'));
  });
  app.get('/offline.html', (req, res) => {
    res.sendFile(path.join(projectRoot, 'public', 'offline.html'));
  });
  app.use('/icons', express.static(path.join(projectRoot, 'public', 'icons'), {
    immutable: true,
    maxAge: '1y'
  }));
  app.use(cookieParser(config.cookieSecret));
  app.use(allowConfiguredFrontendOrigins(config));
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use('/assets', express.static(path.join(projectRoot, 'public'), {
    immutable: false,
    maxAge: config.nodeEnv === 'production' ? '1h' : 0
  }));
  app.use(
    '/vendor/htmx',
    express.static(path.join(projectRoot, 'node_modules', 'htmx.org', 'dist'), {
      immutable: true,
      maxAge: '1y'
    })
  );
  app.use(
    '/vendor/leaflet',
    express.static(path.join(projectRoot, 'node_modules', 'leaflet', 'dist'), {
      immutable: true,
      maxAge: '1y'
    })
  );
  app.use(
    '/vendor/leaflet-heat',
    express.static(path.join(projectRoot, 'node_modules', 'leaflet.heat', 'dist'), {
      immutable: true,
      maxAge: '1y'
    })
  );

  function renderActiveReports(res, deviceHash) {
    const activeReports = database.activeReportsForDevice(deviceHash, now());
    return res.render('partials/active-reports', {
      activeReports,
      now: now()
    });
  }

  app.get('/', (req, res) => {
    const device = ensureDevice(req, res, config);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.render('index', {
      activeReports: database.activeReportsForDevice(device.hash, now()),
      now: now(),
      mapTileUrl: config.mapTileUrl,
      mapAttribution: config.mapAttribution,
      enableDevGps: config.enableDevGps,
      assetBaseUrl: '',
      apiBaseUrl: '',
      staticContentSecurityPolicy: '',
      allowIndexing: false,
      canonicalUrl: '',
      structuredData: '',
      socialImageUrl: ''
    });
  });

  app.get('/healthz', (req, res) => {
    try {
      if (!database.isHealthy()) throw new Error('Database check failed');
      res.status(200).json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.get('/reports/mine', (req, res) => {
    const device = ensureDevice(req, res, config);
    res.set('Cache-Control', 'no-store');
    return renderActiveReports(res, device.hash);
  });

  app.get('/events', (req, res) => {
    const bbox = parseBbox(req.query.bbox);
    if (!bbox) {
      return res.status(400).json({ error: 'A valid bbox query is required' });
    }

    res.status(200);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();

    const remove = hub.add(res, bbox);
    req.on('close', remove);
  });

  app.get('/history', (req, res) => {
    const bbox = parseBbox(req.query.bbox);
    const currentTime = now();
    const observedAt = parseCoordinate(req.query.at);
    if (
      !bbox ||
      !Number.isFinite(observedAt) ||
      observedAt < currentTime - HISTORY_WINDOW_MS ||
      observedAt > currentTime + 60_000
    ) {
      return res.status(400).json({ error: 'A valid time within the last three hours is required' });
    }

    const boundedObservedAt = Math.min(observedAt, currentTime);
    res.set('Cache-Control', 'no-store');
    return res.json({
      cells: database.historyCells(bbox, boundedObservedAt),
      generatedAt: new Date(currentTime).toISOString(),
      observedAt: boundedObservedAt
    });
  });

  app.post('/reports', sameOriginOnly(config), (req, res) => {
    const ipKey = req.ip || req.socket.remoteAddress || 'unknown';
    const ipResult = ipLimiter.check(ipKey);
    if (!ipResult.allowed) {
      const cooldownMs = ipLimiter.startCooldown(ipKey, REPORT_LIMIT_COOLDOWN_MS);
      setRateLimitResponse(res, cooldownMs);
      return res.status(429).send('');
    }

    const reportType = req.body.type;
    const latitude = parseCoordinate(req.body.latitude);
    const longitude = parseCoordinate(req.body.longitude);
    if (
      !['self', 'witness'].includes(reportType) ||
      !validatePhilippinesCoordinates(latitude, longitude)
    ) {
      res.set('HX-Retarget', '#report-status');
      res.set('HX-Reswap', 'innerHTML');
      return res
        .status(422)
        .send('<p class="message message--error">Choose a valid location and report type.</p>');
    }

    const device = ensureDevice(req, res, config);
    const deviceResult = deviceLimiter.check(device.hash);
    if (!deviceResult.allowed) {
      const cooldownMs = deviceLimiter.startCooldown(
        device.hash,
        REPORT_LIMIT_COOLDOWN_MS
      );
      setRateLimitResponse(res, cooldownMs);
      return res.status(429).send('');
    }

    try {
      const result = database.upsertReport({
        reportType,
        latitude,
        longitude,
        deviceHash: device.hash,
        now: now(),
        ttlMs: config.reportTtlMs
      });
      hub.broadcast();
      res.set('HX-Trigger', JSON.stringify({ reportSaved: { refreshed: result.refreshed } }));
      return renderActiveReports(res, device.hash);
    } catch (error) {
      if (error.code === 'ACTIVE_REPORT_LIMIT') {
        res.set('HX-Retarget', '#report-status');
        res.set('HX-Reswap', 'innerHTML');
        return res
          .status(409)
          .send('<p class="message message--error">Resolve an active report before adding another.</p>');
      }
      throw error;
    }
  });

  app.post('/reports/:id/resolve', sameOriginOnly(config), (req, res) => {
    const device = ensureDevice(req, res, config);
    const resolved = database.resolveReport(req.params.id, device.hash, now());
    if (!resolved) return res.status(404).send('Report not found');

    hub.broadcast();
    res.set('HX-Trigger', 'reportResolved');
    return renderActiveReports(res, device.hash);
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error(error);
    if (req.get('HX-Request') === 'true') {
      res.set('HX-Retarget', '#report-status');
      return res
        .status(500)
        .send('<p class="message message--error">Something went wrong. Please try again.</p>');
    }
    return res.status(500).send('Internal server error');
  });

  let sweepTimer;
  if (startTimers) {
    hub.start();
    sweepTimer = setInterval(() => {
      const currentTime = now();
      if (database.deleteExpired(currentTime) > 0) hub.broadcast();
      database.pruneHistory(currentTime - HISTORY_WINDOW_MS);
      ipLimiter.prune();
      deviceLimiter.prune();
    }, config.expirySweepMs);
    sweepTimer.unref?.();
  }

  return {
    app,
    hub,
    sweep() {
      const currentTime = now();
      const changes = database.deleteExpired(currentTime);
      database.pruneHistory(currentTime - HISTORY_WINDOW_MS);
      if (changes > 0) hub.broadcast();
      return changes;
    },
    close() {
      if (sweepTimer) clearInterval(sweepTimer);
      hub.close();
    }
  };
}
