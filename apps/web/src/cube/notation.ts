/**
 * WCA 记法与中文解释。
 */

import type { Move } from './types';
import { parseMove, toMoveList } from './moves';

const FACE_CN: Record<string, string> = {
  U: '上层（Up）',
  D: '下层（Down）',
  F: '前层（Front）',
  B: '后层（Back）',
  R: '右层（Right）',
  L: '左层（Left）',
  u: '上两层（wide u）',
  d: '下两层（wide d）',
  f: '前两层（wide f）',
  b: '后两层（wide b）',
  r: '右两层（wide r）',
  l: '左两层（wide l）',
  M: '中层 M（夹在左右之间）',
  E: '中层 E（夹在上下之间）',
  S: '中层 S（夹在前后之间）',
  x: '整体绕 x 轴旋转（与 R 同向）',
  y: '整体绕 y 轴旋转（与 U 同向）',
  z: '整体绕 z 轴旋转（与 F 同向）',
};

/** 单个转动的中文解释，如 "R2'" → "右层（Right）逆时针旋转 180°"。 */
export function explainMove(move: Move | string): string {
  const p = parseMove(move);
  const name = p.name ?? p.face;
  const wideNames: Record<string, string> = { U: "上侧", D: "下侧", F: "前侧", B: "后侧", R: "右侧", L: "左侧" };
  const base = p.wide > 1 && typeof name === "string" && wideNames[name]
    ? `${wideNames[name]}${(["", "", "两", "三", "四", "五", "六", "七"][p.wide] ?? p.wide)}层`
    : FACE_CN[name] ?? String(name);
  const suffix =
    p.amount === 2 ? '旋转 180°' : (p.prime ?? p.amount === 3) ? '逆时针旋转 90°' : '顺时针旋转 90°';
  return `${base}${suffix}`;
}

/** 整段序列的中文解释列表。 */
export function explainSequence(sequence: string | readonly Move[]): string[] {
  return toMoveList(sequence).map(explainMove);
}

/** 序列转 WCA 字符串（空格分隔）。 */
export function toWcaNotation(sequence: string | readonly Move[]): string {
  return toMoveList(sequence).join(' ');
}

/** WCA 字符串拆分为转动列表。 */
export function parseWcaNotation(text: string): Move[] {
  return toMoveList(text);
}
