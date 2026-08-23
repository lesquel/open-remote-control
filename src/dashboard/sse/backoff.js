/** Apply bounded ±20% jitter so multiple dashboards do not reconnect in lockstep. */
export function jitteredReconnectDelay(baseMs, random = Math.random) {
  const sample = Number(random())
  const unit = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0.5
  return Math.round(baseMs * (0.8 + unit * 0.4))
}
