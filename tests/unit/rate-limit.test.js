import assert from 'node:assert/strict';
import test from 'node:test';
import { SlidingWindowLimiter } from '../../src/rate-limit.js';

test('limits keys within a sliding window and allows them after expiry', () => {
  let clock = 10_000;
  const limiter = new SlidingWindowLimiter({
    limit: 2,
    windowMs: 1000,
    now: () => clock
  });

  assert.equal(limiter.check('device').allowed, true);
  assert.equal(limiter.check('device').allowed, true);
  const blocked = limiter.check('device');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1000);

  clock += 1001;
  assert.equal(limiter.check('device').allowed, true);
});

test('resets accepted attempts after a temporary cooldown', () => {
  let clock = 10_000;
  const limiter = new SlidingWindowLimiter({
    limit: 2,
    windowMs: 300_000,
    now: () => clock
  });

  assert.equal(limiter.check('device').allowed, true);
  assert.equal(limiter.check('device').allowed, true);
  assert.equal(limiter.check('device').allowed, false);
  assert.equal(limiter.startCooldown('device', 5_000), 5_000);

  clock += 4_999;
  assert.equal(limiter.check('device').allowed, false);
  assert.equal(limiter.startCooldown('device', 5_000), 1);

  clock += 1;
  assert.equal(limiter.check('device').allowed, true);
});
