import crypto from 'node:crypto';

export const DEVICE_COOKIE = 'stranded_device';

export function createDeviceToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashDeviceToken(token, secret) {
  return crypto.createHmac('sha256', secret).update(token).digest('hex');
}

export function ensureDevice(req, res, config) {
  const headerToken = req.get('x-device-token');
  if (
    typeof headerToken === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(headerToken)
  ) {
    return {
      token: headerToken,
      hash: hashDeviceToken(headerToken, config.cookieSecret)
    };
  }

  let token = req.signedCookies?.[DEVICE_COOKIE];

  if (typeof token !== 'string' || token.length < 32) {
    token = createDeviceToken();
    res.cookie(DEVICE_COOKIE, token, {
      signed: true,
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000,
      path: '/'
    });
  }

  return {
    token,
    hash: hashDeviceToken(token, config.cookieSecret)
  };
}
