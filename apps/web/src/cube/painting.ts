/**
 * 贴纸配色：六面默认调色板与中文颜色名。
 */

import type { FaceKey } from './types';

export interface Palette {
  U: string;
  D: string;
  F: string;
  B: string;
  R: string;
  L: string;
}

export const DEFAULT_PALETTE: Palette = {
  U: '#ffffff',
  D: '#ffd500',
  F: '#009e60',
  B: '#0051ba',
  R: '#c41e3a',
  L: '#ff5800',
};

export const COLOR_NAMES: Record<FaceKey, string> = {
  U: '白',
  D: '黄',
  F: '绿',
  B: '蓝',
  R: '红',
  L: '橙',
};

export function colorFor(face: FaceKey, palette: Palette = DEFAULT_PALETTE): string {
  return palette[face];
}

export function cssColor(face: FaceKey, palette: Palette = DEFAULT_PALETTE): string {
  return palette[face];
}

export function colorName(face: FaceKey): string {
  return COLOR_NAMES[face];
}

export function paletteFrom(colors: Partial<Palette>): Palette {
  return { ...DEFAULT_PALETTE, ...colors };
}
