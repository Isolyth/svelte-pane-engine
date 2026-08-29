import { describe, expect, it } from 'vitest';
import { retargetPaneRect, samplePaneRect, warpedPaneRect } from '../src/geometry';

const rect = (x: number, width: number) => ({ x, y: 0, width, height: 600 });

describe('pane geometry animation', () => {
  it('changes actual dimensions throughout a transition', () => {
    const animation = retargetPaneRect(warpedPaneRect(rect(0, 1_000)), rect(0, 500), 0, 240);

    expect(samplePaneRect(animation, 0).width).toBe(1_000);
    expect(samplePaneRect(animation, 120).width).toBeGreaterThan(500);
    expect(samplePaneRect(animation, 120).width).toBeLessThan(1_000);
    expect(samplePaneRect(animation, 240).width).toBe(500);
  });

  it('retargets from the currently rendered geometry without jumping', () => {
    const first = retargetPaneRect(warpedPaneRect(rect(0, 1_000)), rect(0, 500), 0, 240);
    const halfway = samplePaneRect(first, 120);
    const second = retargetPaneRect(first, rect(300, 700), 120, 240);

    expect(second.from).toEqual(halfway);
    expect(samplePaneRect(second, 120)).toEqual(halfway);
    expect(samplePaneRect(second, 360)).toEqual(rect(300, 700));
  });

  it('warps geometry during direct manipulation', () => {
    const animation = retargetPaneRect(warpedPaneRect(rect(0, 500)), rect(120, 640), 10, 240, true);
    expect(samplePaneRect(animation, 10)).toEqual(rect(120, 640));
  });
});
