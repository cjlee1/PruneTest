// src/layers/ml/__tests__/retrain.test.ts

import {
  shouldRetrain,
  RETRAIN_INTERVAL_DAYS,
  RETRAIN_MIN_RUNS,
} from '../retrain';

const NOW = new Date('2026-03-31T12:00:00Z');
const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * MS_PER_DAY);
}

describe('shouldRetrain', () => {
  it('returns false when runCount < RETRAIN_MIN_RUNS regardless of lastTrainedAt', () => {
    expect(shouldRetrain(0, null, NOW)).toBe(false);
    expect(shouldRetrain(50, null, NOW)).toBe(false);
    expect(shouldRetrain(99, daysAgo(30), NOW)).toBe(false);
    expect(shouldRetrain(99, null, NOW)).toBe(false);
  });

  it('returns true when runCount >= RETRAIN_MIN_RUNS and lastTrainedAt is null', () => {
    expect(shouldRetrain(100, null, NOW)).toBe(true);
    expect(shouldRetrain(500, null, NOW)).toBe(true);
  });

  it('returns true when interval has elapsed (8 days ago)', () => {
    expect(shouldRetrain(100, daysAgo(8), NOW)).toBe(true);
  });

  it('returns false when interval has NOT elapsed (3 days ago)', () => {
    expect(shouldRetrain(100, daysAgo(3), NOW)).toBe(false);
  });

  it('returns true at exact boundary: runCount = 100 and interval exactly elapsed', () => {
    expect(shouldRetrain(100, daysAgo(RETRAIN_INTERVAL_DAYS), NOW)).toBe(true);
  });

  it('returns false at exact boundary: runCount = 99', () => {
    expect(shouldRetrain(99, daysAgo(RETRAIN_INTERVAL_DAYS + 1), NOW)).toBe(false);
  });

  it('returns false when interval boundary is one day short', () => {
    expect(shouldRetrain(200, daysAgo(RETRAIN_INTERVAL_DAYS - 1), NOW)).toBe(false);
  });
});

describe('constants', () => {
  it('RETRAIN_INTERVAL_DAYS is 7', () => {
    expect(RETRAIN_INTERVAL_DAYS).toBe(7);
  });

  it('RETRAIN_MIN_RUNS is 100', () => {
    expect(RETRAIN_MIN_RUNS).toBe(100);
  });
});
