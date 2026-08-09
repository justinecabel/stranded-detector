export class SlidingWindowLimiter {
  constructor({ limit, windowMs, now = Date.now }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.entries = new Map();
    this.cooldowns = new Map();
  }

  check(key) {
    const currentTime = this.now();
    const cooldownUntil = this.cooldowns.get(key);
    if (cooldownUntil) {
      if (cooldownUntil > currentTime) {
        return {
          allowed: false,
          retryAfterMs: cooldownUntil - currentTime
        };
      }
      this.cooldowns.delete(key);
    }

    const cutoff = currentTime - this.windowMs;
    const recent = (this.entries.get(key) || []).filter((time) => time > cutoff);

    if (recent.length >= this.limit) {
      const retryAfterMs = Math.max(1, recent[0] + this.windowMs - currentTime);
      this.entries.set(key, recent);
      return { allowed: false, retryAfterMs };
    }

    recent.push(currentTime);
    this.entries.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length };
  }

  startCooldown(key, durationMs) {
    const currentTime = this.now();
    const existingUntil = this.cooldowns.get(key);
    if (existingUntil > currentTime) return existingUntil - currentTime;

    this.entries.delete(key);
    this.cooldowns.set(key, currentTime + durationMs);
    return durationMs;
  }

  prune() {
    const currentTime = this.now();
    const cutoff = currentTime - this.windowMs;
    for (const [key, times] of this.entries) {
      const recent = times.filter((time) => time > cutoff);
      if (recent.length === 0) this.entries.delete(key);
      else this.entries.set(key, recent);
    }
    for (const [key, cooldownUntil] of this.cooldowns) {
      if (cooldownUntil <= currentTime) this.cooldowns.delete(key);
    }
  }
}
