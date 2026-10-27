import type { Point } from './geometry';
export interface Contact extends Point {
  id: number;
}

// Preserve identity/order, but copy every current coordinate from the same input snapshot.
export function snapshotContacts(
  previous: ReadonlyMap<number, Point>,
  current: readonly Contact[],
): Map<number, Point> {
  const incoming = new Map(current.map((contact) => [contact.id, { x: contact.x, y: contact.y }]));
  const result = new Map<number, Point>();
  for (const id of previous.keys()) if (incoming.has(id)) result.set(id, incoming.get(id)!);
  for (const [id, point] of incoming) if (!result.has(id)) result.set(id, point);
  return result;
}
export function sameContacts(a: ReadonlyMap<number, Point>, b: ReadonlyMap<number, Point>) {
  return a.size === b.size && [...a.keys()].every((id) => b.has(id));
}
export function samePositions(a: ReadonlyMap<number, Point>, b: ReadonlyMap<number, Point>) {
  return (
    sameContacts(a, b) &&
    [...a].every(([id, point]) => {
      const next = b.get(id)!;
      return point.x === next.x && point.y === next.y;
    })
  );
}
