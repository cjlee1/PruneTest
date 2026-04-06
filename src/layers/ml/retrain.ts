// src/layers/ml/retrain.ts
// Utility to determine whether the GBDT model should be retrained based on
// accumulated run count and time since the last training run.

export const RETRAIN_INTERVAL_DAYS = 7;
export const RETRAIN_MIN_RUNS = 100;

/**
 * Returns true when conditions warrant retraining the GBDT model:
 * - At least RETRAIN_MIN_RUNS historical runs must exist.
 * - Either no prior training date is recorded, or at least
 *   RETRAIN_INTERVAL_DAYS have elapsed since the last training.
 */
export function shouldRetrain(
  runCount: number,
  lastTrainedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (runCount < RETRAIN_MIN_RUNS) return false;
  if (!lastTrainedAt) return true;
  const daysSince = (now.getTime() - lastTrainedAt.getTime()) / 86_400_000;
  return daysSince >= RETRAIN_INTERVAL_DAYS;
}
