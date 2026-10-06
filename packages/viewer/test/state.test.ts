import { describe, expect, it } from 'vitest';
import {
  ElementState,
  HIDDEN_ALPHA,
  HIGHLIGHT_STRENGTH,
  HOVER_TINT,
  SELECTION_TINT,
} from '../src/state.js';

const texel = (state: ElementState, i: number) => [...state.data.subarray(i * 4, i * 4 + 4)];
const alpha = (strength: number) => Math.round(strength * (HIDDEN_ALPHA - 1));
const byte = (c: number) => Math.round(c * 255);

describe('ElementState', () => {
  it('lays out one texel per element in rows of at most maxWidth', () => {
    const state = new ElementState(10, 4);
    expect([state.width, state.height, state.data.length]).toEqual([4, 3, 48]);
    const small = new ElementState(3);
    expect([small.width, small.height]).toEqual([3, 1]);
    expect(new ElementState(0).data.length).toBe(4);
  });

  it('starts with every texel clear', () => {
    expect(new ElementState(5).data.every((b) => b === 0)).toBe(true);
  });

  it('writes highlights as colour and strength', () => {
    const state = new ElementState(5);
    state.highlight([1, 3], [1, 0.5, 0]);
    expect(texel(state, 1)).toEqual([255, 128, 0, alpha(HIGHLIGHT_STRENGTH)]);
    expect(texel(state, 3)).toEqual(texel(state, 1));
    expect(texel(state, 2)).toEqual([0, 0, 0, 0]);
  });

  it('lets later highlights cover earlier ones and uncovers them on removal', () => {
    const state = new ElementState(5);
    const red = state.highlight([0, 1, 2], [1, 0, 0]);
    const green = state.highlight([1, 2], [0, 1, 0]);
    const blue = state.highlight([2], [0, 0, 1]);
    expect(texel(state, 2).slice(0, 3)).toEqual([0, 0, 255]);
    green();
    expect(texel(state, 1).slice(0, 3)).toEqual([255, 0, 0]);
    expect(texel(state, 2).slice(0, 3)).toEqual([0, 0, 255]);
    blue();
    expect(texel(state, 2).slice(0, 3)).toEqual([255, 0, 0]);
    red();
    red();
    expect(state.data.every((b) => b === 0)).toBe(true);
  });

  it('ranks hidden over hover over selection over highlight', () => {
    const state = new ElementState(4);
    state.highlight([0, 1, 2, 3], [1, 1, 0]);
    state.setSelection([1, 2, 3]);
    state.setHover([2, 3]);
    const show = state.hide([3]);
    expect(texel(state, 0)[3]).toBe(alpha(HIGHLIGHT_STRENGTH));
    expect(texel(state, 1)).toEqual([
      ...SELECTION_TINT.color.map(byte),
      alpha(SELECTION_TINT.strength),
    ]);
    expect(texel(state, 2)).toEqual([...HOVER_TINT.color.map(byte), alpha(HOVER_TINT.strength)]);
    expect(texel(state, 3)).toEqual([0, 0, 0, HIDDEN_ALPHA]);
    show();
    expect(texel(state, 3)).toEqual(texel(state, 2));
  });

  it('replaces hover and selection sets', () => {
    const state = new ElementState(4);
    state.setHover([0, 1]);
    state.setHover([1, 2]);
    expect(texel(state, 0)).toEqual([0, 0, 0, 0]);
    expect(texel(state, 2)[3]).toBe(alpha(HOVER_TINT.strength));
    state.setHover([]);
    expect(state.data.every((b) => b === 0)).toBe(true);
  });

  it('counts overlapping hides', () => {
    const state = new ElementState(2);
    const a = state.hide([0, 0, 1]);
    const b = state.hide([0]);
    a();
    a();
    expect(state.isHidden(0)).toBe(true);
    expect(state.isHidden(1)).toBe(false);
    b();
    expect(state.isHidden(0)).toBe(false);
    expect(texel(state, 0)).toEqual([0, 0, 0, 0]);
  });

  it('bumps its version on every change', () => {
    const state = new ElementState(2);
    const versions = [state.version];
    const clear = state.highlight([0], [1, 1, 1]);
    versions.push(state.version);
    state.setSelection([1]);
    versions.push(state.version);
    clear();
    versions.push(state.version);
    expect(new Set(versions).size).toBe(4);
  });

  it('tells whether a texel range has any tint', () => {
    const state = new ElementState(100);
    expect(state.tintedIn(0, 100)).toBe(false);
    state.highlight([40, 60], [1, 0, 0]);
    expect(state.tintedIn(0, 40)).toBe(false);
    expect(state.tintedIn(41, 60)).toBe(false);
    expect(state.tintedIn(41, 61)).toBe(true);
    state.setHover([5]);
    expect(state.tintedIn(5, 6)).toBe(true);
  });
});
