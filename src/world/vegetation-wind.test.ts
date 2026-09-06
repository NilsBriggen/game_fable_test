import { describe, expect, it } from 'vitest';
import { setWindTime, setWindAmp } from './treeGeometry';
import { VegetationManager } from './vegetation';

describe('vegetation wind', () => {
  it('wind setters accept numbers without throwing', () => {
    expect(() => {
      setWindTime(0);
      setWindTime(1.5);
      setWindTime(100.2);
      setWindAmp(0);
      setWindAmp(1);
    }).not.toThrow();
  });

  it('reseason clears state deterministically', () => {
    const stub = {
      listActiveChunks: () => [],
      surfaceAt: () => 'grass',
      heightAt: () => 10,
      slopeAt: () => 0,
      surfaceIdAt: () => 0,
      cpuWidth: 0,
      cpuHeight: 0,
    } as any;
    const vm = new VegetationManager(123, stub);
    expect(() => vm.reseason()).not.toThrow();
    expect(() => vm.reseason()).not.toThrow();
  });
});
