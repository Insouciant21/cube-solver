/**
 * Move engine for the Cube Solver.
 *
 * Implements face turns, wide moves and whole-cube rotations for cube orders
 * 2..7 using a sticker-position model: every sticker has a 3D position on the
 * surface of the cube, a move rotates the stickers in the affected layer, and
 * the stickers are then re-bucketed back into the six flat face arrays.
 *
 * Notation support:
 *  - WCA: U D L R F B, ' (prime), 2 (half), x y z (whole-cube rotations)
 *  - Wide: Rw / 3Rw / Uw and lowercase u d f b l r
 *  - Chinese: 上 下 前 后 左 右 with 逆/反 (prime) and 两/二/2 (half)
 */

import {
  CubeSnapshot,
  CubeState,
  Face,
  MAX_HISTORY,
  cloneStickers,
  snapshotOf,
} from './state'

export type Vec3 = readonly [number, number, number]

export interface ParsedMove {
  /** Face for turns/wide moves, or axis letter for whole-cube rotations. */
  face: Face | 'x' | 'y' | 'z'
  /** Compatibility name used by notation helpers. */
  name?: Face | 'x' | 'y' | 'z'
  /** Whether this move is a prime (counter-clockwise) turn. */
  prime?: boolean
  /** 0 for whole-cube rotations, 1 for face turns, >= 2 for wide moves. */
  wide: number
  /** Quarter turns clockwise: 1, 2 (half) or 3 (counter-clockwise). */
  amount: 1 | 2 | 3
  /** Original notation string. */
  notation?: string
}

export type MoveLike = string | ParsedMove

export const FACE_KEYS: readonly Face[] = ['U', 'D', 'F', 'B', 'L', 'R']

const CHINESE_FACE: Record<string, Face> = {
  上: 'U',
  下: 'D',
  前: 'F',
  后: 'B',
  左: 'L',
  右: 'R',
}

/** Parses a move in WCA, wide or Chinese notation. */
export function parseMove(input: string): ParsedMove {
  if (typeof input !== 'string') {
    throw new Error(`Invalid move: expected a string, got ${typeof input}`)
  }
  const raw = input.trim()
  if (raw.length === 0) throw new Error('Invalid move: empty string')

  // Chinese notation: 上/下/前/后/左/右 with optional 逆/反/' and 两/二/2.
  const zh = raw.match(/^([上下前后左右])([逆反′']?)([两二2]?)$/)
  if (zh) {
    const face = CHINESE_FACE[zh[1]]
    const prime = zh[2].length > 0
    const half = zh[3] === '两' || zh[3] === '二' || zh[3] === '2'
    if (prime && half) throw new Error(`Invalid move: ${raw}`)
    return {
      face,
      name: face,
      prime,
      wide: 1,
      amount: half ? 2 : prime ? 3 : 1,
      notation: raw,
    }
  }

  const m = raw.match(/^([0-9]*)([UDLRFBxyzudlrfb])(w?)([′'逆反]?)([2两二]?)$/)
  if (!m) throw new Error(`Invalid move: ${raw}`)
  const digits = m[1]
  const letter = m[2]
  const hasW = m[3] === 'w'
  const prime = m[4].length > 0
  const half = m[5] === '2' || m[5] === '两' || m[5] === '二'
  if (prime && half) throw new Error(`Invalid move: ${raw}`)

  const upper = letter.toUpperCase()
  const face: Face | 'x' | 'y' | 'z' =
    upper === 'X' ? 'x' : upper === 'Y' ? 'y' : upper === 'Z' ? 'z' : (upper as Face)

  let wide: number
  if (face === 'x' || face === 'y' || face === 'z') {
    if (digits || hasW) throw new Error(`Invalid whole-cube move: ${raw}`)
    wide = 0
  } else if (hasW) {
    wide = digits ? parseInt(digits, 10) : 2
    if (wide < 2) throw new Error(`Invalid wide move: ${raw}`)
  } else if (/^[udlrfb]$/.test(letter)) {
    wide = 2
  } else if (digits) {
    throw new Error(`Invalid move: ${raw} (a number before a face letter requires 'w')`)
  } else {
    wide = 1
  }

  return {
    face,
    name: face,
    prime,
    wide,
    amount: half ? 2 : prime ? 3 : 1,
    notation: raw,
  }
}

type Axis = 'x' | 'y' | 'z'

interface Cell {
  pos: Vec3
  face: Face
  index: number
}

/** Rotation (axis + clockwise direction) for every face and whole-cube move. */
const ROTATION: Record<Face | 'x' | 'y' | 'z', { axis: Axis; sign: 1 | -1 }> = {
  U: { axis: 'y', sign: -1 },
  D: { axis: 'y', sign: 1 },
  // The front/back sticker coordinate frame has its screen Y axis inverted
  // relative to Three.js. Keep these signs aligned with the visual turn so a
  // completed F/F' animation does not land on the opposite state.
  F: { axis: 'z', sign: 1 },
  B: { axis: 'z', sign: -1 },
  L: { axis: 'x', sign: 1 },
  R: { axis: 'x', sign: -1 },
  x: { axis: 'x', sign: -1 },
  y: { axis: 'y', sign: -1 },
  // Whole-cube z follows the WCA F direction. Keep it aligned with the API
  // replay because high-order OLL parity solutions may contain z/z'.
  z: { axis: 'z', sign: 1 },
}

function posKey(pos: Vec3): string {
  return `${pos[0]},${pos[1]},${pos[2]}`
}

/**
 * Builds the static sticker geometry: every sticker has a fixed 3D position on
 * the surface and a (face, index) home. Moves permute colors between homes.
 */
function buildGeometry(order: number): { cells: Cell[]; byPos: Map<string, Cell> } {
  const half = (order - 1) / 2
  const dist = half + 0.5
  const cells: Cell[] = []
  const byPos = new Map<string, Cell>()

  const put = (face: Face, row: number, col: number, pos: Vec3) => {
    const cell = { pos, face, index: row * order + col }
    cells.push(cell)
    byPos.set(posKey(pos), cell)
  }

  for (let row = 0; row < order; row++) {
    for (let col = 0; col < order; col++) {
      const x = col - half
      put('U', row, col, [x, dist, row - half])
      put('D', row, col, [x, -dist, half - row])
      put('F', row, col, [x, half - row, dist])
      put('B', row, col, [half - col, half - row, -dist])
      put('L', row, col, [-dist, half - row, col - half])
      put('R', row, col, [dist, half - row, half - col])
    }
  }
  return { cells, byPos }
}

/** Rotates a position about an axis by sign * 90 degrees, `turns` times. */
function rotatePos(pos: Vec3, axis: Axis, sign: 1 | -1, turns: number): Vec3 {
  let [x, y, z] = pos
  for (let t = 0; t < turns; t++) {
    if (sign === -1) {
      if (axis === 'x') [y, z] = [z, -y]
      else if (axis === 'y') [x, z] = [-z, x]
      else [x, y] = [-y, x]
    } else {
      if (axis === 'x') [y, z] = [-z, y]
      else if (axis === 'y') [x, z] = [z, -x]
      else [x, y] = [y, -x]
    }
  }
  return [x, y, z]
}

/** True when a sticker position lies inside the turned layer of a face move. */
function isAffected(pos: Vec3, face: Face, wide: number, order: number): boolean {
  const half = (order - 1) / 2
  const dist = half + 0.5
  const [x, y, z] = pos
  switch (face) {
    case 'U':
      return y > dist - wide
    case 'D':
      return y < -dist + wide
    case 'F':
      return z > dist - wide
    case 'B':
      return z < -dist + wide
    case 'L':
      return x < -dist + wide
    case 'R':
      return x > dist - wide
  }
}

function pushHistory(state: CubeState, snapshot: CubeSnapshot): CubeSnapshot[] {
  const next = [...state.history, snapshot]
  return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
}

/** Applies a single move to the cube state and returns a new state. */
export function applyMove(state: CubeState, move: MoveLike): CubeState {
  const parsed = typeof move === 'string' ? parseMove(move) : move
  const order = state.order
  if (parsed.face !== 'x' && parsed.face !== 'y' && parsed.face !== 'z' && (parsed.wide < 1 || parsed.wide > order)) {
    throw new Error(`Move ${parsed.face} exceeds cube order ${order}`)
  }
  const { cells, byPos } = buildGeometry(order)
  const next = cloneStickers(state.stickers)
  const rotation = ROTATION[parsed.face]

  const affected =
    parsed.face === 'x' || parsed.face === 'y' || parsed.face === 'z'
      ? cells
      : cells.filter((c) =>
          isAffected(c.pos, parsed.face as Face, Math.max(1, parsed.wide), order),
        )

  for (const cell of affected) {
    const newPos = rotatePos(cell.pos, rotation.axis, rotation.sign, parsed.amount)
    const target = byPos.get(posKey(newPos))
    if (!target) {
      throw new Error(`Move ${parsed.face} mapped a sticker to an invalid position`)
    }
    next[target.face][target.index] = state.stickers[cell.face][cell.index]
  }

  return {
    order,
    stickers: next,
    revision: state.revision + 1,
    history: pushHistory(state, snapshotOf(state)),
    future: [],
  }
}

/** Applies a sequence of moves, returning the final state. */
export function applyMoves(state: CubeState, moves: MoveLike[] | string): CubeState {
  const list: MoveLike[] =
    typeof moves === 'string'
      ? moves.trim().length === 0
        ? []
        : moves.trim().split(/\s+/)
      : moves
  let current = state
  for (const move of list) current = applyMove(current, move)
  return current
}

/** Compatibility alias used by history/random modules. */
export function applySequence(state: CubeState, moves: readonly MoveLike[] | string): CubeState {
  return applyMoves(state, moves as MoveLike[] | string)
}

/** Normalizes a notation string or move list to string move tokens. */
export function toMoveList(sequence: string | readonly MoveLike[]): string[] {
  const moves = typeof sequence === 'string' ? sequence.trim().split(/\s+/).filter(Boolean) : sequence
  return moves.map((move) => {
    if (typeof move === 'string') return move
    if (move.notation) return move.notation
    const suffix = move.amount === 2 ? '2' : move.amount === 3 ? "'" : ''
    return `${move.name}${move.wide > 1 ? `${move.wide}w` : ''}${suffix}`
  })
}
