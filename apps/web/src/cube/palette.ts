import type { CubeColor, CubeFace } from './types';

export const CANONICAL_FACE_ORDER = ['U', 'L', 'F', 'R', 'B', 'D'] as const satisfies readonly CubeFace[];

export const CANONICAL_COLOR_ORDER = [
  'white',
  'orange',
  'green',
  'red',
  'blue',
  'yellow',
] as const satisfies readonly CubeColor[];

export const FACE_TO_COLOR = {
  U: 'white',
  L: 'orange',
  F: 'green',
  R: 'red',
  B: 'blue',
  D: 'yellow',
} as const satisfies Readonly<Record<CubeFace, CubeColor>>;

export function isCanonicalFaceOrder(order: readonly CubeFace[]): boolean {
  return (
    order.length === CANONICAL_FACE_ORDER.length &&
    order.every((face, index) => face === CANONICAL_FACE_ORDER[index])
  );
}

export function assertCanonicalFaceOrder(
  order: readonly CubeFace[],
): asserts order is typeof CANONICAL_FACE_ORDER {
  if (!isCanonicalFaceOrder(order)) {
    throw new Error(
      `Expected face order ${CANONICAL_FACE_ORDER.join('')}, received ${order.join('')}`,
    );
  }
}
