import { describe, expect, it } from 'vitest';

import { faceNormal, faceletPosition, rowColOf } from './coords';

describe('coordinate round trips', () => {
  it.each([
    [2, 'U', 0, 1],
    [3, 'U', 2, 0],
    [7, 'U', 6, 5],
    [2, 'F', 1, 0],
    [3, 'F', 1, 2],
    [7, 'F', 5, 6],
    [2, 'R', 1, 1],
    [3, 'R', 0, 2],
    [7, 'R', 4, 3],
  ] as const)('round trips order %i face %s row %i col %i', (order, face, row, col) => {
    const position = faceletPosition(order, face, row * order + col);
    expect(rowColOf(position, faceNormal(face), order)).toEqual({ face, row, col });
  });

  it('infers the order when it is omitted', () => {
    const position = faceletPosition(7, 'F', 4 * 7 + 3);
    expect(rowColOf(position, faceNormal('F'))).toEqual({ face: 'F', row: 4, col: 3 });
  });

  it('rejects a position that is not a sticker center', () => {
    expect(() => rowColOf({ x: 0.25, y: 1.5, z: 0 }, faceNormal('U'), 3)).toThrow();
  });
});
