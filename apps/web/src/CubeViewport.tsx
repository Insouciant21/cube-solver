import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Box, Button, ButtonGroup, SvgIcon, Typography } from '@mui/material';
import * as THREE from 'three';

import type { CubeState } from './cube/state';
import { animationAngle } from './cube/animation';
import { parseMove } from './cube/moves';
import {
  DEFAULT_VIEW_TRANSFORM,
  FACE_NORMALS,
  FACE_ROTATIONS,
  FIT_VIEW_DISTANCE,
  STICKER_COLORS,
  advanceDragState,
  facingFaces,
  orbitView,
  serializeView,
  shouldPaintSticker,
  viewForFace,
  viewCamera,
  zoomView,
  type DragState,
  type ViewFacing,
  type ViewTransform,
  type ViewportFace,
} from './cube/viewport';

export type CubeFace = ViewportFace;

export interface CubeAnimation {
  move: string;
  key: number;
}

export interface CubeViewportProps {
  state: CubeState;
  onStickerClick?: (face: CubeFace, index: number) => void;
  animation?: CubeAnimation | null;
  animationDuration?: number;
  onViewChange?: (facing: ViewFacing, view: ViewTransform) => void;
  onViewControlsReady?: (controls: ViewControls | null) => void;
}

const FACE_NORMAL_VECTORS = Object.fromEntries(
  Object.entries(FACE_NORMALS).map(([face, normal]) => [face, new THREE.Vector3(...normal)]),
) as Record<CubeFace, THREE.Vector3>;

interface StickerMesh extends THREE.Mesh {
  userData: {
    face: CubeFace;
    index: number;
  };
}

interface CubieGroup extends THREE.Group {
  userData: {
    cubePosition: THREE.Vector3;
    stickers: StickerMesh[];
  };
}

interface AnimationLayer {
  axis: 'x' | 'y' | 'z';
  side: 1 | -1;
  sign: 1 | -1;
  turns: 1 | 2 | 3;
}

export interface ViewControls {
  reset: () => void;
  fit: () => void;
  face: (face: CubeFace) => void;
}

function ResetViewIcon() {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
    </SvgIcon>
  );
}

function FitViewIcon() {
  return (
    <SvgIcon fontSize="small" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h6V2H2v8h2V4Zm10-2v2h6v6h2V2h-8ZM4 14H2v8h8v-2H4v-6Zm16 0v6h-6v2h8v-8h-2Z" />
    </SvgIcon>
  );
}

function stickerPosition(face: CubeFace, row: number, column: number, order: number): THREE.Vector3 {
  const half = 1;
  const offset = (index: number) => -half + (index + 0.5) * (2 / order);
  const horizontal = offset(column);
  const vertical = -offset(row);

  switch (face) {
    case 'F':
      return new THREE.Vector3(horizontal, vertical, half);
    case 'B':
      return new THREE.Vector3(-horizontal, vertical, -half);
    case 'U':
      return new THREE.Vector3(horizontal, half, -vertical);
    case 'D':
      return new THREE.Vector3(horizontal, -half, vertical);
    case 'R':
      return new THREE.Vector3(half, vertical, -horizontal);
    case 'L':
      return new THREE.Vector3(-half, vertical, horizontal);
  }
}

function cubieCoordinate(index: number, order: number): number {
  return -1 + (index + 0.5) * (2 / order);
}

function cubieKey(position: THREE.Vector3): string {
  return `${position.x.toFixed(6)},${position.y.toFixed(6)},${position.z.toFixed(6)}`;
}

function faceAxis(face: CubeFace): { axis: 'x' | 'y' | 'z'; side: 1 | -1; sign: 1 | -1 } {
  switch (face) {
    case 'U':
      return { axis: 'y', side: 1, sign: -1 };
    case 'D':
      return { axis: 'y', side: -1, sign: 1 };
    case 'F':
      return { axis: 'z', side: 1, sign: -1 };
    case 'B':
      return { axis: 'z', side: -1, sign: 1 };
    case 'L':
      return { axis: 'x', side: -1, sign: 1 };
    case 'R':
      return { axis: 'x', side: 1, sign: -1 };
  }
}

function animationLayer(move: string): AnimationLayer | null {
  try {
    const parsed = parseMove(move);
    if (parsed.face === 'x' || parsed.face === 'y' || parsed.face === 'z') {
      return {
        axis: parsed.face,
        side: 1,
        sign: -1,
        turns: parsed.amount,
      };
    }
    return { ...faceAxis(parsed.face), turns: parsed.amount };
  } catch {
    return null;
  }
}

function isInLayer(position: THREE.Vector3, layer: AnimationLayer, order: number, wide: number): boolean {
  if (wide === 0 || wide >= order) return true;
  const coordinate = position[layer.axis];
  const threshold = 1 - (2 * wide) / order;
  return layer.side > 0 ? coordinate >= threshold - 0.001 : coordinate <= -threshold + 0.001;
}

function easeInOut(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

const canvasStyle: CSSProperties = {
  display: 'block',
  height: '100%',
  width: '100%',
};

export default function CubeViewport({
  state,
  onStickerClick,
  animation = null,
  animationDuration = 420,
  onViewChange,
  onViewControlsReady,
}: CubeViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbackRef = useRef(onStickerClick);
  const viewCallbackRef = useRef(onViewChange);
  const controlsCallbackRef = useRef(onViewControlsReady);
  const viewTransformRef = useRef<ViewTransform>({ ...DEFAULT_VIEW_TRANSFORM });
  const viewControlsRef = useRef<ViewControls>({
    reset: () => undefined,
    fit: () => undefined,
    face: () => undefined,
  });
  const sceneControllerRef = useRef<{ update: (next: CubeState, move?: string, duration?: number) => void } | null>(null);
  const latestStateRef = useRef(state);
  const dragState = useRef<DragState>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    callbackRef.current = onStickerClick;
  }, [onStickerClick]);

  useEffect(() => {
    viewCallbackRef.current = onViewChange;
  }, [onViewChange]);

  useEffect(() => {
    controlsCallbackRef.current = onViewControlsReady;
  }, [onViewControlsReady]);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    // jsdom and browsers without WebGL still need the surrounding UI to
    // render. Keep a semantic canvas placeholder in those environments.
    if (typeof window.WebGLRenderingContext === 'undefined') {
      canvas.dataset.viewTransform = serializeView(viewTransformRef.current);
      canvas.dataset.viewDistance = viewTransformRef.current.distance.toFixed(3);
      return undefined;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, canvas, alpha: true });
    } catch {
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    const cube = new THREE.Group();
    scene.add(cube);

    const initialState = latestStateRef.current;
    const cellSize = 2 / initialState.order;
    // Keep the core inside the resting surface cubies. A full-size black box
    // would poke through the rotating layer at intermediate angles.
    const coreSize = Math.max(0.12, 2 - cellSize * 1.9);
    const coreGeometry = new THREE.BoxGeometry(coreSize, coreSize, coreSize);
    const coreMaterial = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.72, metalness: 0.05 });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    cube.add(core);

    const stickerGeometry = new THREE.PlaneGeometry(cellSize * 0.91, cellSize * 0.91);
    const cubieGeometry = new THREE.BoxGeometry(cellSize * 0.9, cellSize * 0.9, cellSize * 0.9);
    const cubieGroups: CubieGroup[] = [];
    const cubieByKey = new Map<string, CubieGroup>();
    for (let xIndex = 0; xIndex < initialState.order; xIndex += 1) {
      for (let yIndex = 0; yIndex < initialState.order; yIndex += 1) {
        for (let zIndex = 0; zIndex < initialState.order; zIndex += 1) {
          const isSurface = xIndex === 0 || xIndex === initialState.order - 1
            || yIndex === 0 || yIndex === initialState.order - 1
            || zIndex === 0 || zIndex === initialState.order - 1;
          if (!isSurface) continue;
          const position = new THREE.Vector3(
            cubieCoordinate(xIndex, initialState.order),
            cubieCoordinate(yIndex, initialState.order),
            cubieCoordinate(zIndex, initialState.order),
          );
          const cubie = new THREE.Group() as unknown as CubieGroup;
          cubie.position.copy(position);
          cubie.userData = { cubePosition: position.clone(), stickers: [] };
          cubie.add(new THREE.Mesh(cubieGeometry, coreMaterial));
          cube.add(cubie);
          cubieGroups.push(cubie);
          cubieByKey.set(cubieKey(position), cubie);
        }
      }
    }
    const stickerMeshes: StickerMesh[] = [];
    const faces: CubeFace[] = ['U', 'D', 'F', 'B', 'R', 'L'];

    for (const face of faces) {
      for (let index = 0; index < initialState.order * initialState.order; index += 1) {
        const row = Math.floor(index / initialState.order);
        const column = index % initialState.order;
        const material = new THREE.MeshBasicMaterial({
          color: STICKER_COLORS[initialState.stickers[face][index]],
          // Sticker colors should remain readable from every side of the
          // cube, including the face viewed from below.
          toneMapped: false,
        });
        const worldPosition = stickerPosition(face, row, column, initialState.order);
        const cubiePosition = worldPosition.clone();
        const inset = 1 - 1 / initialState.order;
        const normal = FACE_NORMAL_VECTORS[face];
        if (normal.x !== 0) cubiePosition.x = normal.x * inset;
        if (normal.y !== 0) cubiePosition.y = normal.y * inset;
        if (normal.z !== 0) cubiePosition.z = normal.z * inset;
        const cubie = cubieByKey.get(cubieKey(cubiePosition));
        if (!cubie) continue;
        const sticker = new THREE.Mesh(stickerGeometry, material) as unknown as StickerMesh;
        sticker.position.copy(worldPosition).sub(cubie.position);
        sticker.position.addScaledVector(FACE_NORMAL_VECTORS[face], 0.012);
        sticker.rotation.set(...FACE_ROTATIONS[face]);
        sticker.userData = { face, index };
        cubie.add(sticker);
        cubie.userData.stickers.push(sticker);
        stickerMeshes.push(sticker);
      }
    }

    scene.add(new THREE.HemisphereLight('#ffffff', '#30343a', 2.4));
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const activePointers = new Map<number, { x: number; y: number }>();
    let pinchDistance: number | null = null;
    let multiPointerGesture = false;
    let renderedState = initialState;
    let animationGroup: THREE.Group | null = null;
    let animationFrame: number | null = null;
    let cancelAnimation: () => void = () => undefined;

    const render = () => renderer.render(scene, camera);
    const applyViewTransform = () => {
      const view = viewTransformRef.current;
      const cameraView = viewCamera(view);
      camera.position.set(...cameraView.position);
      camera.up.set(...cameraView.up);
      camera.lookAt(0, 0, 0);
      cube.rotation.set(0, 0, 0);
      canvas.dataset.viewTransform = serializeView(view);
      canvas.dataset.viewDistance = view.distance.toFixed(3);
      const facing = facingFaces(view);
      canvas.dataset.viewFaces = `${facing.front},${facing.top}`;
      viewCallbackRef.current?.(facing, view);
      render();
    };
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      applyViewTransform();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const rotate = (deltaX: number, deltaY: number) => {
      viewTransformRef.current = orbitView(viewTransformRef.current, deltaX, deltaY);
      applyViewTransform();
    };

    const distanceBetweenPointers = () => {
      const points = [...activePointers.values()];
      if (points.length < 2) return null;
      return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    };

    const updateMaterials = (next: CubeState) => {
      for (const sticker of stickerMeshes) {
        const material = sticker.material as THREE.MeshBasicMaterial;
        material.color.set(STICKER_COLORS[next.stickers[sticker.userData.face][sticker.userData.index]]);
      }
    };

    const updateAnimationMaterials = (
      next: CubeState,
      previous: CubeState,
      groups: readonly CubieGroup[],
    ) => {
      const movingStickers = new Set<StickerMesh>();
      for (const cubie of groups) {
        cubie.userData.stickers.forEach((sticker) => movingStickers.add(sticker));
      }
      for (const sticker of stickerMeshes) {
        const source = movingStickers.has(sticker) ? previous : next;
        const material = sticker.material as THREE.MeshBasicMaterial;
        material.color.set(STICKER_COLORS[source.stickers[sticker.userData.face][sticker.userData.index]]);
      }
    };

    const animateMove = (previous: CubeState, next: CubeState, move: string, duration: number) => {
      // A new state must never leave an older layer running on top of it (for
      // example when the user edits during playback).
      cancelAnimation();
      const layer = animationLayer(move);
      if (!layer || previous.order !== next.order || duration <= 0) {
        updateMaterials(next);
        return;
      }
      let parsedWide = 0;
      try {
        parsedWide = parseMove(move).wide;
      } catch {
        updateMaterials(next);
        return;
      }
      const affected = cubieGroups.filter((cubie) => isInLayer(
        cubie.userData.cubePosition,
        layer,
        next.order,
        parsedWide,
      ));
      if (affected.length === 0) {
        updateMaterials(next);
        return;
      }

      const group = new THREE.Group();
      animationGroup = group;
      cube.add(group);
      // Set the stationary and moving stickers in one pass so a manual move
      // can never paint the complete next state for one browser frame.
      updateAnimationMaterials(next, previous, affected);
      const movingObjects: THREE.Object3D[] = parsedWide === 0 ? [...affected, core] : affected;
      for (const object of movingObjects) group.add(object);

      const angle = animationAngle(layer.sign, layer.turns);
      const start = performance.now();
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      const actualDuration = reducedMotion ? 0 : duration;
      const finish = () => {
        if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
        for (const object of movingObjects) {
          group.remove(object);
          cube.add(object);
        }
        updateMaterials(next);
        cube.remove(group);
        if (animationGroup === group) animationGroup = null;
        cancelAnimation = () => undefined;
        render();
      };
      cancelAnimation = finish;

      if (actualDuration === 0) {
        group.rotation[layer.axis] = angle;
        finish();
        return;
      }

      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / actualDuration);
        group.rotation[layer.axis] = angle * easeInOut(progress);
        render();
        if (progress < 1) animationFrame = window.requestAnimationFrame(tick);
        else finish();
      };
      animationFrame = window.requestAnimationFrame(tick);
    };

    sceneControllerRef.current = {
      update: (next, move, duration = 420) => {
        const previous = renderedState;
        renderedState = next;
        if (move && previous !== next) animateMove(previous, next, move, duration);
        else {
          cancelAnimation();
          updateMaterials(next);
        }
        render();
      },
    };

    viewControlsRef.current = {
      reset: () => {
        viewTransformRef.current = { ...DEFAULT_VIEW_TRANSFORM };
        applyViewTransform();
      },
      fit: () => {
        viewTransformRef.current = zoomView(viewTransformRef.current, FIT_VIEW_DISTANCE);
        applyViewTransform();
      },
      face: (face: CubeFace) => {
        viewTransformRef.current = viewForFace(face, viewTransformRef.current.distance);
        applyViewTransform();
      },
    };
    controlsCallbackRef.current?.(viewControlsRef.current);

    const onPointerDown = (event: PointerEvent) => {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size > 1) {
        multiPointerGesture = true;
        dragState.current = { ...dragState.current, moved: true };
        pinchDistance = distanceBetweenPointers();
      }
      dragState.current = {
        active: true,
        moved: activePointers.size > 1,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      canvas.style.cursor = 'grabbing';
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (activePointers.size > 1) {
        const nextDistance = distanceBetweenPointers();
        if (pinchDistance && nextDistance && nextDistance > 0) {
          viewTransformRef.current = zoomView(
            viewTransformRef.current,
            viewTransformRef.current.distance * (pinchDistance / nextDistance),
          );
          applyViewTransform();
        }
        pinchDistance = nextDistance;
        return;
      }
      if (!dragState.current.active) return;
      const { state: nextDragState, deltaX, deltaY } = advanceDragState(
        dragState.current,
        event.clientX,
        event.clientY,
      );
      dragState.current = nextDragState;
      rotate(deltaX, deltaY);
    };
    const finishPointer = (event: PointerEvent, cancelled: boolean) => {
      const wasClick = shouldPaintSticker(dragState.current, cancelled || multiPointerGesture);
      dragState.current = { ...dragState.current, active: false };
      activePointers.delete(event.pointerId);
      if (activePointers.size < 2) pinchDistance = null;
      if (activePointers.size === 0) multiPointerGesture = false;
      canvas.style.cursor = callbackRef.current ? 'crosshair' : 'grab';
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!wasClick || !callbackRef.current) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(stickerMeshes.filter((sticker) => sticker.visible), false)[0];
      if (hit) {
        const sticker = hit.object as StickerMesh;
        callbackRef.current(sticker.userData.face, sticker.userData.index);
      }
    };
    const onPointerUp = (event: PointerEvent) => finishPointer(event, false);
    const onPointerCancel = (event: PointerEvent) => finishPointer(event, true);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      viewTransformRef.current = zoomView(
        viewTransformRef.current,
        viewTransformRef.current.distance + event.deltaY * 0.006,
      );
      applyViewTransform();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerCancel);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimation();
      observer.disconnect();
      if (sceneControllerRef.current) sceneControllerRef.current = null;
      viewControlsRef.current = { reset: () => undefined, fit: () => undefined, face: () => undefined };
      controlsCallbackRef.current?.(null);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      stickerGeometry.dispose();
      cubieGeometry.dispose();
      for (const sticker of stickerMeshes) (sticker.material as THREE.Material).dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      renderer.dispose();
    };
  }, [state.order]);

  useLayoutEffect(() => {
    sceneControllerRef.current?.update(state, animation?.move, animationDuration);
  }, [state, animation?.key, animation?.move, animationDuration]);

  const quickFaces: CubeFace[] = ['F', 'B', 'U', 'D', 'L', 'R'];
  return (
    <Box
      className="cube-viewport-shell"
      sx={{ width: '100%' }}
    >
      <Box
        className="cube-viewport-toolbar"
        aria-label="3D 视角控制"
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: { xs: 0.75, sm: 1.25 },
          p: { xs: 0.5, sm: 0.75 },
          borderBottom: '1px solid #263945',
          bgcolor: '#0d171e',
          boxShadow: 'none',
        }}
      >
        <Box
          className="cube-face-presets"
          role="group"
          aria-label="六面快速视角"
          sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: { xs: 0.5, sm: 0.875 } }}
        >
          <Typography
            component="span"
            sx={{ display: { xs: 'none', sm: 'inline' }, px: 0.5, color: '#8fa7b2', fontSize: '.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            快速对准
          </Typography>
          <ButtonGroup variant="outlined" size="small" aria-label="六面快速对准" sx={{ flexShrink: 0 }}>
            {quickFaces.map((face) => (
              <Button
                key={face}
                type="button"
                onClick={() => viewControlsRef.current.face(face)}
                aria-label={`查看 ${face} 面`}
                title={`查看 ${face} 面`}
                sx={{
                  minWidth: { xs: 32, sm: 36 },
                  minHeight: { xs: 32, sm: 35 },
                  px: { xs: 0.75, sm: 1 },
                  py: 0.5,
                  color: '#d2e0e4',
                  bgcolor: 'rgb(12 20 27 / 76%)',
                  borderColor: '#3c5662',
                  fontSize: '.73rem',
                  fontWeight: 760,
                  '&:hover': { bgcolor: 'rgb(28 48 57 / 92%)', borderColor: '#72b8b0', zIndex: 1 },
                }}
              >
                {face}
              </Button>
            ))}
          </ButtonGroup>
        </Box>

        <Box className="cube-view-controls" sx={{ display: 'flex', alignItems: 'center', gap: 0.625, flexShrink: 0 }}>
          <Button
            aria-label="重置视角"
            onClick={() => viewControlsRef.current.reset()}
            title="重置视角"
            type="button"
            startIcon={<ResetViewIcon />}
            sx={{
              minWidth: { xs: 36, sm: 112 },
              minHeight: { xs: 32, sm: 35 },
              px: { xs: 0.75, sm: 1.125 },
              color: '#e8edf2',
              bgcolor: 'rgb(12 20 27 / 76%)',
              borderColor: '#486372',
              fontSize: '.72rem',
              '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.625 } },
              '&:hover': { bgcolor: 'rgb(28 48 57 / 92%)', borderColor: '#8cc8c4' },
            }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>重置视角</Box>
          </Button>
          <Button
            aria-label="适应窗口"
            onClick={() => viewControlsRef.current.fit()}
            title="适应窗口"
            type="button"
            startIcon={<FitViewIcon />}
            sx={{
              minWidth: { xs: 36, sm: 108 },
              minHeight: { xs: 32, sm: 35 },
              px: { xs: 0.75, sm: 1.125 },
              color: '#e8edf2',
              bgcolor: 'rgb(12 20 27 / 76%)',
              borderColor: '#486372',
              fontSize: '.72rem',
              '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.625 } },
              '&:hover': { bgcolor: 'rgb(28 48 57 / 92%)', borderColor: '#8cc8c4' },
            }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>适应窗口</Box>
          </Button>
        </Box>
      </Box>
      <Box className="cube-viewport-stage" sx={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          aria-label={onStickerClick ? '3D 魔方编辑器。点击贴纸修改颜色，拖动旋转视角。' : '3D 魔方预览。拖动旋转视角。'}
          data-testid="three-cube-canvas"
          role="img"
          style={{ ...canvasStyle, touchAction: 'none', cursor: onStickerClick ? 'crosshair' : 'grab' }}
        />
        <Typography component="p" className="cube-gesture-hint" sx={{ position: 'absolute', right: 1.625, bottom: 1, left: 1.625, zIndex: 2, m: 0, color: '#9db0b9', fontSize: '.72rem', pointerEvents: 'none', textAlign: 'center', textShadow: '0 1px 2px #000' }}>
          拖动旋转 · 滚轮或双指缩放 · 点击贴纸编辑颜色
        </Typography>
      </Box>
    </Box>
  );
}
