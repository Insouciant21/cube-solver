/**
 * Coordinates and layout helpers for the 3D cube view.
 *
 * Converts between the flat facelet indices stored in `CubeState.stickers`
 * and three-dimensional sticker positions on a cube centered at the origin.
 * Stickers are spaced one unit apart, so a cube of order N spans from -N/2
 * to +N/2 along each axis.
 */

export type Position = { x: number; y: number; z: number };

export const FACES = ['U', 'D', 'F', 'B', 'L', 'R'] as const;

export type Face = (typeof FACES)[number];

type FaceLayout = {
  normal: Position;
  u: Position;
  v: Position;
};

const LAYOUT: Record<Face, FaceLayout> = {
  U: {
    normal: { x: 0, y: 1, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: -1 },
  },
  D: {
    normal: { x: 0, y: -1, z: 0 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 0, z: 1 },
  },
  F: {
    normal: { x: 0, y: 0, z: 1 },
    u: { x: 1, y: 0, z: 0 },
    v: { x: 0, y: 1, z: 0 },
  },
  B: {
    normal: { x: 0, y: 0, z: -1 },
    u: { x: -1, y: 0, z: 0 },
    v: { x: 0, y: 1, z: 0 },
  },
  L: {
    normal: { x: -1, y: 0, z: 0 },
    u: { x: 0, y: 0, z: 1 },
    v: { x: 0, y: 1, z: 0 },
  },
  R: {
    normal: { x: 1, y: 0, z: 0 },
    u: { x: 0, y: 0, z: -1 },
    v: { x: 0, y: 1, z: 0 },
  },
};

function halfOffset(order: number): number {
  return (order - 1) / 2;
}

/**
 * Center position of the sticker at a flat facelet index for a given order.
 * Index 0 is the top-left sticker of the face; indices increase row by row.
 */
export function faceletPosition(order: number, face: Face, index: number): Position {
  const layout = LAYOUT[face];
  const row = Math.floor(index / order);
  const col = index % order;
  const offset = halfOffset(order);
  const half = order / 2;
  const across = col - offset;
  const down = row - offset;
  return {
    x: layout.normal.x * half + across * layout.u.x + down * layout.v.x,
    y: layout.normal.y * half + across * layout.u.y + down * layout.v.y,
    z: layout.normal.z * half + across * layout.u.z + down * layout.v.z,
  };
}

/** Center positions of every sticker of one face, in flat facelet order. */
export function faceletPositions(order: number, face: Face): Position[] {
  const positions: Position[] = [];
  for (let i = 0; i < order * order; i += 1) {
    positions.push(faceletPosition(order, face, i));
  }
  return positions;
}

/** Center positions of every sticker of every face, keyed by face. */
export function allFaceletPositions(order: number): Record<Face, Position[]> {
  const out: Record<Face, Position[]> = {
    U: [],
    D: [],
    F: [],
    B: [],
    L: [],
    R: [],
  };
  for (let f = 0; f < FACES.length; f += 1) {
    out[FACES[f]] = faceletPositions(order, FACES[f]);
  }
  return out;
}

/** Unit normal vector pointing outward from the center of a face. */
export function faceNormal(face: Face): Position {
  return { ...LAYOUT[face].normal };
}

/** Half-extent of a cube of the given order (sticker centers span -N/2..N/2). */
export function cubeHalfExtent(order: number): number {
  return order / 2;
}
