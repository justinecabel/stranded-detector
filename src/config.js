import path from 'node:path';

export const DEFAULT_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
export const DEFAULT_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : value;
}

function parseFrontendOrigins(value) {
  if (!value) return [];

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = new URL(entry);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('FRONTEND_ORIGINS entries must use http or https');
      }
      if (url.pathname !== '/' || url.search || url.hash) {
        throw new Error('FRONTEND_ORIGINS entries must be origins without paths');
      }
      return url.origin;
    });
}

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const isProduction = env.NODE_ENV === 'production';

  return {
    nodeEnv: env.NODE_ENV || 'development',
    port: Number(env.PORT || 3000),
    databasePath: path.resolve(env.DATABASE_PATH || './data/stranded.sqlite'),
    cookieSecret:
      env.COOKIE_SECRET ||
      (isProduction ? '' : 'development-only-cookie-secret-change-me'),
    cookieSecure: parseBoolean(env.COOKIE_SECURE, isProduction),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    mapTileUrl: env.MAP_TILE_URL || DEFAULT_TILE_URL,
    mapAttribution: env.MAP_ATTRIBUTION || DEFAULT_ATTRIBUTION,
    enableDevGps: parseBoolean(env.ENABLE_DEV_GPS, !isProduction),
    frontendOrigins: parseFrontendOrigins(env.FRONTEND_ORIGINS),
    reportTtlMs: Number(env.REPORT_TTL_MS || 5 * 60 * 1000),
    expirySweepMs: Number(env.EXPIRY_SWEEP_MS || 1000),
    heartbeatMs: Number(env.HEARTBEAT_MS || 15_000)
  };
}

export function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  if (!config.cookieSecret || config.cookieSecret.length < 32) {
    throw new Error('COOKIE_SECRET must contain at least 32 characters');
  }
  if (!Number.isFinite(config.reportTtlMs) || config.reportTtlMs < 1000) {
    throw new Error('REPORT_TTL_MS must be at least 1000');
  }
}
