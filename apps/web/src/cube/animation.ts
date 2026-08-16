export function animationAngle(sign: 1 | -1, turns: 1 | 2 | 3): number {
  // parseMove represents a prime turn as three clockwise quarter turns for
  // the state engine. The visual animation should still take the shortest
  // path, otherwise a single R' visibly travels 270 degrees.
  const quarterTurns = turns === 3 ? -1 : turns;
  return sign * quarterTurns * (Math.PI / 2);
}
