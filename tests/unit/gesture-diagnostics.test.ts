import { describe, it, expect } from 'vitest';
import {
  GestureRecorder,
  diagnosticsAllowed,
  browserIdentity,
} from '../../src/lib/gesture-diagnostics';

describe('local diagnostic opt-in', () => {
  it.each([
    [true, true, '?diagnostics=1', true],
    [true, true, '', false],
    [true, false, '?diagnostics=1', false],
    [false, true, '?diagnostics=1', false],
    [false, false, '?diagnostics=1', false],
    [true, true, '?diagnostics=0', false],
  ])('requires development demo and an explicit flag: %s %s %s', (dev, demo, search, expected) => {
    expect(diagnosticsAllowed(dev as boolean, demo as boolean, search as string)).toBe(expected);
  });
  it('extracts only browser family/version, not the device UA', () => {
    expect(browserIdentity('Mozilla private-model secret Firefox/158.0.2')).toEqual({
      name: 'Firefox',
      version: '158.0.2',
    });
  });
});
describe('bounded in-memory recording', () => {
  it('does not record while stopped; start resets entries, IDs and counters', () => {
    const recorder = new GestureRecorder(10, () => 1);
    recorder.record('ignored', {});
    expect(recorder.count).toBe(0);
    recorder.start();
    const event = new Event('pointermove');
    expect(recorder.eventId(event)).toBe(recorder.eventId(event));
    recorder.record('sample', { x: 1 });
    recorder.stop();
    const count = recorder.count;
    recorder.record('ignored', {});
    expect(recorder.count).toBe(count);
    recorder.start();
    expect(recorder.count).toBe(1);
    expect(recorder.truncated).toBe(false);
    recorder.clear();
    expect(recorder.count).toBe(0);
    expect(recorder.recording).toBe(false);
  });
  it('caps memory and reports dropped records instead of silently pretending completeness', () => {
    const recorder = new GestureRecorder(3, () => 1);
    recorder.start();
    for (let index = 0; index < 100; index++) recorder.record('sample', { index });
    expect(recorder.count).toBe(3);
    expect(recorder.truncated).toBe(true);
    expect(JSON.parse(recorder.export()).limits.dropped).toBe(98);
  });
  it('keeps initial/final state, relative timing and non-finite diagnostic evidence', () => {
    let clock = 5,
      scale = 1;
    const recorder = new GestureRecorder(10, () => clock);
    const remove = recorder.setProvider(() => ({ scale }));
    recorder.start();
    clock = 15;
    scale = 2;
    recorder.record('calculation', { requestedZoom: Infinity, ratio: NaN });
    recorder.stop();
    scale = 99;
    const data = JSON.parse(recorder.export());
    expect(data.initial.scale).toBe(1);
    expect(data.final.scale).toBe(2);
    expect(data.entries[1].elapsedMs).toBe(10);
    expect(data.entries[1].data).toEqual({ requestedZoom: 'Infinity', ratio: 'NaN' });
    remove();
    expect(recorder.ready).toBe(false);
  });
});
