import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as THREE from 'three';
import CubeViewport from './CubeViewport';
import {
  DEFAULT_VIEW_TRANSFORM,
  FACE_NORMALS,
  FACE_ROTATIONS,
  STICKER_COLORS,
  advanceDragState,
  facingFaces,
  orbitView,
  serializeView,
  shouldPaintSticker,
  viewForFace,
  zoomView,
  type DragState,
} from './cube/viewport';
import { createCubeState } from './cube/state';
import { animationAngle } from './cube/animation';

describe('CubeViewport', () => {
  it('renders a three.js canvas', () => {
    const state = createCubeState(3);
    const { container } = render(<CubeViewport state={state} />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(screen.getByLabelText('3D 魔方预览。拖动旋转视角。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '重置视角' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '适应窗口' })).toBeTruthy();
    expect(container.querySelector('.cube-viewport-toolbar')?.contains(container.querySelector('canvas'))).toBe(false);
    expect(container.querySelector('.cube-viewport-toolbar')?.nextElementSibling).toHaveClass('cube-viewport-stage');
  });

  it('uses the same orange and red indices as CubeState', () => {
    expect(STICKER_COLORS[4]).toBe('#FF5900');
    expect(STICKER_COLORS[5]).toBe('#B90000');
  });

  it('rotates every sticker plane normal toward its visible cube face', () => {
    for (const face of Object.keys(FACE_NORMALS) as Array<keyof typeof FACE_NORMALS>) {
      const actual = new THREE.Vector3(0, 0, 1).applyEuler(
        new THREE.Euler(...FACE_ROTATIONS[face]),
      );
      expect(actual.angleTo(new THREE.Vector3(...FACE_NORMALS[face]))).toBeLessThan(1e-10);
    }
  });

  it('treats cumulative small pointer moves as a drag', () => {
    let drag: DragState = {
      active: true,
      moved: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
    };

    drag = advanceDragState(drag, 2, 0).state;
    expect(drag.moved).toBe(false);
    drag = advanceDragState(drag, 4, 0).state;
    expect(drag.moved).toBe(true);
  });

  it('never paints a cancelled pointer gesture', () => {
    const click: DragState = {
      active: true,
      moved: false,
      startX: 0,
      startY: 0,
      lastX: 0,
      lastY: 0,
    };

    expect(shouldPaintSticker(click, false)).toBe(true);
    expect(shouldPaintSticker(click, true)).toBe(false);
  });

  it('keeps zoom bounded while allowing the orbit to cross the poles', () => {
    const rotated = orbitView({ ...DEFAULT_VIEW_TRANSFORM }, 10, -200);
    expect(rotated.rotationY).toBeCloseTo(0.67);
    expect(rotated.rotationX).toBeCloseTo(-2.58);
    expect(rotated.orientation).toBeDefined();
    expect(zoomView(rotated, 100).distance).toBe(7.5);
    expect(zoomView(rotated, 0).distance).toBe(3.2);
    expect(serializeView(DEFAULT_VIEW_TRANSFORM)).toBe('-0.180,0.550,5.200');
  });

  it('animates prime turns along the shortest quarter-turn path', () => {
    expect(animationAngle(-1, 1)).toBeCloseTo(-Math.PI / 2);
    expect(animationAngle(-1, 3)).toBeCloseTo(Math.PI / 2);
    expect(animationAngle(1, 2)).toBeCloseTo(Math.PI);
  });

  it('can aim every cube face at the camera', () => {
    for (const face of Object.keys(FACE_NORMALS) as Array<keyof typeof FACE_NORMALS>) {
      expect(facingFaces(viewForFace(face)).front).toBe(face);
    }
  });
});
