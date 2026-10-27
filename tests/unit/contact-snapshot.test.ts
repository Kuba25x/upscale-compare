import { expect, it } from 'vitest';
import { snapshotContacts, sameContacts, samePositions } from '../../src/lib/contact-snapshot';
it('refreshes both coordinates while preserving contact identity when input order changes', () => {
  const previous = new Map([
    [10, { x: 295, y: 419 }],
    [20, { x: 263, y: 256 }],
  ]);
  const current = [
    { id: 20, x: 288, y: 332 },
    { id: 10, x: 295, y: 419 },
  ];
  const next = snapshotContacts(previous, current);
  expect([...next.keys()]).toEqual([10, 20]);
  expect(next.get(20)).toEqual({ x: 288, y: 332 });
  expect(previous.get(20)).toEqual({ x: 263, y: 256 });
  current[0].y = 900;
  expect(next.get(20)!.y).toBe(332);
  expect(sameContacts(previous, next)).toBe(true);
  expect(samePositions(previous, next)).toBe(false);
});
it('distinguishes contact replacement from movement, without matching Pointer IDs', () => {
  const previous = new Map([
    [10, { x: 1, y: 2 }],
    [20, { x: 3, y: 4 }],
  ]);
  const next = snapshotContacts(previous, [
    { id: 20, x: 3, y: 4 },
    { id: 30, x: 1, y: 2 },
  ]);
  expect([...next.keys()]).toEqual([20, 30]);
  expect(sameContacts(previous, next)).toBe(false);
  expect(samePositions(previous, next)).toBe(false);
});
it('recognizes identical snapshots and removes ended contacts without stale coordinates', () => {
  const previous = new Map([
    [10, { x: 1, y: 2 }],
    [20, { x: 3, y: 4 }],
  ]);
  expect(
    samePositions(
      previous,
      snapshotContacts(previous, [
        { id: 20, x: 3, y: 4 },
        { id: 10, x: 1, y: 2 },
      ]),
    ),
  ).toBe(true);
  expect([...snapshotContacts(previous, [{ id: 20, x: 5, y: 6 }])]).toEqual([[20, { x: 5, y: 6 }]]);
  expect(snapshotContacts(previous, []).size).toBe(0);
});
