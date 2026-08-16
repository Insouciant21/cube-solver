export const STICKER_COLORS = [
  '#FFFFFF',
  '#FFD500',
  '#009B48',
  '#0046AD',
  '#FF5900',
  '#B90000',
] as const;

export type ViewportFace = 'U' | 'D' | 'F' | 'B' | 'R' | 'L';

export const FACE_NORMALS: Record<ViewportFace, readonly [number, number, number]> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
};

export const FACE_ROTATIONS: Record<ViewportFace, readonly [number, number, number]> = {
  U: [-Math.PI / 2, 0, 0],
  D: [Math.PI / 2, 0, 0],
  F: [0, 0, 0],
  B: [0, Math.PI, 0],
  R: [0, Math.PI / 2, 0],
  L: [0, -Math.PI / 2, 0],
};

export interface ViewTransform {
  rotationX: number;
  rotationY: number;
  rotationZ?: number;
  distance: number;
  /**
   * The accumulated camera orientation. The Euler fields above are retained
   * for readable diagnostics and backwards-compatible saved view data, while
   * this quaternion prevents a pitch clamp/gimbal lock at the poles.
   */
  orientation?: ViewQuaternion;
}

export type ViewQuaternion = readonly [number, number, number, number];

export interface ViewFacing {
  /** The face whose outward normal points closest to the camera. */
  front: ViewportFace;
  /** The face that occupies the upper part of the current view. */
  top: ViewportFace;
}

export const DEFAULT_VIEW_TRANSFORM: Readonly<ViewTransform> = {
  rotationX: -0.18,
  rotationY: 0.55,
  rotationZ: 0,
  distance: 6.6,
};

export const FIT_VIEW_DISTANCE = 5.2;
const MIN_VIEW_DISTANCE = 3.2;
const MAX_VIEW_DISTANCE = 7.5;
const ORBIT_SENSITIVITY = 0.012;

function normalizeQuaternion(quaternion: ViewQuaternion): ViewQuaternion {
  const length = Math.hypot(...quaternion);
  if (length < 0.000001) return [0, 0, 0, 1];
  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ];
}

function multiplyQuaternion(a: ViewQuaternion, b: ViewQuaternion): ViewQuaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function quaternionFromAxisAngle(axis: readonly [number, number, number], angle: number): ViewQuaternion {
  const length = Math.hypot(...axis);
  if (length < 0.000001) return [0, 0, 0, 1];
  const half = angle / 2;
  const sine = Math.sin(half) / length;
  return [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(half)];
}

function rotateVector(
  quaternion: ViewQuaternion,
  vector: readonly [number, number, number],
): readonly [number, number, number] {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vector;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + y * tz - z * ty,
    vy + w * ty + z * tx - x * tz,
    vz + w * tz + x * ty - y * tx,
  ];
}

function legacyQuaternion(view: ViewTransform): ViewQuaternion {
  // rotationX is the old normalized elevation field. Negating it preserves
  // the existing default view while allowing the new quaternion path to pass
  // through both poles without ever clamping the camera.
  const elevation = -view.rotationX;
  const yaw = quaternionFromAxisAngle([0, 1, 0], view.rotationY);
  const pitch = quaternionFromAxisAngle([1, 0, 0], -elevation);
  const roll = quaternionFromAxisAngle([0, 0, 1], view.rotationZ ?? 0);
  return multiplyQuaternion(yaw, multiplyQuaternion(pitch, roll));
}

/** Returns the accumulated orientation, falling back to legacy Euler data. */
export function viewQuaternion(view: ViewTransform): ViewQuaternion {
  return view.orientation ? normalizeQuaternion(view.orientation) : legacyQuaternion(view);
}

export interface ViewCamera {
  position: readonly [number, number, number];
  up: readonly [number, number, number];
}

/** Converts the free orientation into camera position and screen-up vectors. */
export function viewCamera(view: ViewTransform): ViewCamera {
  const quaternion = viewQuaternion(view);
  const direction = rotateVector(quaternion, [0, 0, 1]);
  const up = rotateVector(quaternion, [0, 1, 0]);
  return {
    position: [direction[0] * view.distance, direction[1] * view.distance, direction[2] * view.distance],
    up,
  };
}

export function orbitView(
  view: ViewTransform,
  deltaX: number,
  deltaY: number,
): ViewTransform {
  const current = viewQuaternion(view);
  const right = rotateVector(current, [1, 0, 0]);
  const up = rotateVector(current, [0, 1, 0]);
  // Rotate around the current screen axes. Unlike spherical yaw/pitch this
  // remains usable after the camera crosses the top or bottom pole, and also
  // preserves the roll needed for a genuinely free 3D view.
  const horizontal = quaternionFromAxisAngle(up, deltaX * ORBIT_SENSITIVITY);
  const vertical = quaternionFromAxisAngle(right, deltaY * ORBIT_SENSITIVITY);
  return {
    ...view,
    rotationX: view.rotationX + deltaY * ORBIT_SENSITIVITY,
    rotationY: view.rotationY + deltaX * ORBIT_SENSITIVITY,
    orientation: multiplyQuaternion(horizontal, multiplyQuaternion(vertical, current)),
  };
}

/** Converts the persisted elevation into a camera polar angle. */
export function viewElevation(view: ViewTransform): number {
  return -view.rotationX;
}

/** Creates a view that points the requested face directly at the camera. */
export function viewForFace(face: ViewportFace, distance = DEFAULT_VIEW_TRANSFORM.distance): ViewTransform {
  const presets: Record<ViewportFace, { rotationX: number; rotationY: number }> = {
    F: { rotationX: 0, rotationY: 0 },
    B: { rotationX: 0, rotationY: Math.PI },
    R: { rotationX: 0, rotationY: Math.PI / 2 },
    L: { rotationX: 0, rotationY: -Math.PI / 2 },
    U: { rotationX: -Math.PI / 2, rotationY: 0 },
    D: { rotationX: Math.PI / 2, rotationY: 0 },
  };
  return { ...presets[face], rotationZ: 0, distance };
}

function dot(normal: readonly [number, number, number], vector: readonly [number, number, number]): number {
  return normal[0] * vector[0] + normal[1] * vector[1] + normal[2] * vector[2];
}

function bestFace(vector: readonly [number, number, number], visibleOnly: boolean, viewDirection: readonly [number, number, number]): ViewportFace {
  const faces = (Object.keys(FACE_NORMALS) as ViewportFace[]).filter((face) => !visibleOnly || dot(FACE_NORMALS[face], viewDirection) > -0.02);
  return faces.reduce((best, face) => dot(FACE_NORMALS[face], vector) > dot(FACE_NORMALS[best], vector) ? face : best, faces[0] ?? 'F');
}

/** Returns a readable F/U-style description of the current camera view. */
export function facingFaces(view: ViewTransform): ViewFacing {
  const camera = viewCamera(view);
  const viewDirection: readonly [number, number, number] = [
    camera.position[0] / view.distance,
    camera.position[1] / view.distance,
    camera.position[2] / view.distance,
  ];
  return {
    front: bestFace(viewDirection, false, viewDirection),
    top: bestFace(camera.up, true, viewDirection),
  };
}

export function zoomView(view: ViewTransform, distance: number): ViewTransform {
  return {
    ...view,
    distance: Math.max(MIN_VIEW_DISTANCE, Math.min(MAX_VIEW_DISTANCE, distance)),
  };
}

export function serializeView(view: ViewTransform): string {
  return [view.rotationX, view.rotationY, view.distance]
    .map((value) => value.toFixed(3))
    .join(',');
}

export interface DragState {
  active: boolean;
  moved: boolean;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

export function advanceDragState(
  state: DragState,
  x: number,
  y: number,
): { state: DragState; deltaX: number; deltaY: number } {
  const deltaX = x - state.lastX;
  const deltaY = y - state.lastY;
  return {
    state: {
      ...state,
      moved:
        state.moved ||
        Math.abs(x - state.startX) + Math.abs(y - state.startY) > 3,
      lastX: x,
      lastY: y,
    },
    deltaX,
    deltaY,
  };
}

export function shouldPaintSticker(
  state: DragState,
  cancelled: boolean,
): boolean {
  return state.active && !state.moved && !cancelled;
}
