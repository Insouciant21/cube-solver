import { describe, expect, it } from 'vitest'

import { applyMove } from './moves'
import {
  createCubeState,
  redo,
  resetCube,
  undo,
  validateStoredCubeState,
} from './state'

function snapshot(state: ReturnType<typeof createCubeState>) {
  return JSON.stringify(state.stickers)
}

describe('cube state', () => {
  it.each([2, 3, 4, 5, 6, 7])('creates a solved order-%i cube', (order) => {
    const state = createCubeState(order)
    expect(state.order).toBe(order)
    expect(Object.values(state.stickers)).toHaveLength(6)
    for (const stickers of Object.values(state.stickers)) {
      expect(stickers).toHaveLength(order * order)
      expect(new Set(stickers).size).toBe(1)
    }
  })

  it('updates immutably, increments revisions, and caps history at 200 entries', () => {
    const initial = createCubeState(3)
    let state = initial
    for (let index = 0; index < 205; index += 1) state = applyMove(state, 'R')

    expect(initial.revision).toBe(0)
    expect(snapshot(initial)).not.toBe(snapshot(state))
    expect(state.revision).toBe(205)
    expect(state.history).toHaveLength(200)
    expect(state.history[0].revision).toBe(5)
  })

  it('supports undo, redo, and reset', () => {
    const initial = createCubeState(4)
    const moved = applyMove(applyMove(initial, 'Rw'), "U'")
    const onceUndone = undo(moved)
    const twiceUndone = undo(onceUndone)

    expect(snapshot(twiceUndone)).toBe(snapshot(initial))
    const onceRedone = redo(twiceUndone)
    expect(snapshot(onceRedone)).toBe(snapshot(onceUndone))
    expect(onceUndone.revision).toBe(moved.revision + 1)
    expect(twiceUndone.revision).toBe(onceUndone.revision + 1)
    expect(onceRedone.revision).toBe(twiceUndone.revision + 1)
    expect(snapshot(resetCube(moved))).toBe(snapshot(initial))
    expect(resetCube(moved).revision).toBe(moved.revision + 1)
  })

  it('accepts valid storage and rejects malformed or unsupported storage', () => {
    const state = applyMove(createCubeState(5), '3Rw')
    expect(validateStoredCubeState(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(validateStoredCubeState(null)).toBeNull()
    expect(validateStoredCubeState({ ...state, order: 8 })).toBeNull()
    expect(validateStoredCubeState({ ...state, revision: -1 })).toBeNull()
    expect(validateStoredCubeState({ ...state, stickers: { ...state.stickers, U: [] } })).toBeNull()
    expect(validateStoredCubeState({ ...state, history: 'not-an-array' })).toBeNull()
  })
})
