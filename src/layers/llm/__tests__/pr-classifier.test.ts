// src/layers/llm/__tests__/pr-classifier.test.ts
// Unit tests for classifyDiffType() heuristic.

import { classifyDiffType } from '../pr-classifier';

describe('classifyDiffType', () => {
  // 1. Empty diff → 'unknown'
  it("returns 'unknown' for an empty diff", () => {
    expect(classifyDiffType('')).toBe('unknown');
  });

  it("returns 'unknown' for a whitespace-only diff", () => {
    expect(classifyDiffType('   \n  \n')).toBe('unknown');
  });

  // 2. Only new function/class/export additions → 'feature'
  it("returns 'feature' for diff with only new function additions", () => {
    const diff = [
      '+function doSomething() {',
      '+  return 42;',
      '+}',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('feature');
  });

  it("returns 'feature' for diff with only new export function additions", () => {
    const diff = [
      '+export function authenticate(user: string) {',
      '+  return true;',
      '+}',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('feature');
  });

  it("returns 'feature' for diff with only new class additions", () => {
    const diff = [
      '+class AuthManager {',
      '+  private token = "";',
      '+}',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('feature');
  });

  it("returns 'feature' for diff with only new export class additions", () => {
    const diff = [
      '+export class SessionStore {',
      '+  private data = {};',
      '+}',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('feature');
  });

  it("returns 'feature' for diff with only new const arrow-function additions", () => {
    const diff = [
      '+const handler = (event: Event) => {',
      '+  console.log(event);',
      '+};',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('feature');
  });

  it("returns 'feature' for diff with only new export const arrow-function additions", () => {
    const diff = [
      '+export const fetchUser = (id: string) => {',
      '+  return fetch(`/users/${id}`);',
      '+};',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('feature');
  });

  // 3. Only deletions/modifications → 'bugfix'
  it("returns 'bugfix' for diff with only deletion lines", () => {
    const diff = [
      '-const oldImplementation = () => true;',
      '-  return false;',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('bugfix');
  });

  it("ignores file-header --- lines when counting deletions", () => {
    const diff = [
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '-const broken = () => false;',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('bugfix');
  });

  it("ignores file-header +++ lines when counting additions", () => {
    const diff = [
      '--- a/src/auth.ts',
      '+++ b/src/auth.ts',
      '-const old = () => false;',
    ].join('\n');
    // Only one deletion, zero feature additions → 'bugfix'
    expect(classifyDiffType(diff)).toBe('bugfix');
  });

  // 4. Mixed diff where additions dominate → 'feature'
  it("returns 'feature' for mixed diff where new definitions outnumber deletions", () => {
    const diff = [
      '-const old = () => false;',                          // 1 deletion
      '+export function newFeature() {',                    // 1 feature
      '+export class NewClass {',                           // 1 feature
      '+export const helper = (x: number) => x * 2;',      // 1 feature
    ].join('\n');
    // 3 feature additions vs 1 deletion → 'feature'
    expect(classifyDiffType(diff)).toBe('feature');
  });

  // 5. Mixed diff where deletions dominate → 'bugfix'
  it("returns 'bugfix' for mixed diff where deletions outnumber new definitions", () => {
    const diff = [
      '-const a = 1;',                                      // 1 deletion
      '-const b = 2;',                                      // 1 deletion
      '-const c = 3;',                                      // 1 deletion
      '+export function newFeature() {',                    // 1 feature
    ].join('\n');
    // 1 feature addition vs 3 deletions → 'bugfix'
    expect(classifyDiffType(diff)).toBe('bugfix');
  });

  // 6. Edge: equal counts (not strictly greater) → 'bugfix'
  it("returns 'bugfix' when new-definition count equals deletion count", () => {
    const diff = [
      '-const old = () => false;',                          // 1 deletion
      '+export function newFeature() {',                    // 1 feature
    ].join('\n');
    // 1 === 1, not strictly greater → 'bugfix'
    expect(classifyDiffType(diff)).toBe('bugfix');
  });

  // 7. Additions that do NOT match the feature pattern → 'unknown' if no deletions
  it("returns 'unknown' when additions are regular code lines (no deletions)", () => {
    const diff = [
      '+  console.log("hello");',                           // not a feature pattern
      '+  return true;',
    ].join('\n');
    expect(classifyDiffType(diff)).toBe('unknown');
  });
});
