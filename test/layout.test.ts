import { describe, expect, it } from 'vitest';
import {
  addPanePanel,
  calculatePaneGeometry,
  detachPanePanels,
  emptyPaneLayout,
  findPaneGroup,
  isPaneLayoutState,
  paneGroup,
  placeDetachedPaneGroup,
  removePanePanel,
  type PaneLayoutState,
} from '../src/layout';

const panel = (id: string, minimumWidth?: number) => ({
  id,
  component: id,
  title: id,
  minimumWidth,
});

describe('pane layout tree', () => {
  it('inserts local binary splits and tabs without a layout library', () => {
    const state = emptyPaneLayout();
    const first = addPanePanel(state, panel('files'));
    const second = addPanePanel(state, panel('projects'), {
      referenceGroupId: first.id,
      direction: 'left',
      sizeRatio: 0.25,
    });
    addPanePanel(state, panel('tasks'), {
      referenceGroupId: first.id,
      direction: 'within',
    });

    expect(state.root).toMatchObject({
      type: 'split',
      axis: 'horizontal',
      ratio: 0.25,
      first: { id: second.id, panels: ['projects'] },
      second: { id: first.id, panels: ['files', 'tasks'], activePanelId: 'tasks' },
    });
  });

  it('collapses empty branches when panels are removed', () => {
    const state = emptyPaneLayout();
    const files = addPanePanel(state, panel('files'));
    addPanePanel(state, panel('projects'), {
      referenceGroupId: files.id,
      direction: 'left',
    });

    removePanePanel(state, 'projects');

    expect(state.root).toMatchObject({ type: 'group', panels: ['files'] });
    expect(state.panels.projects).toBeUndefined();
  });

  it('detaches either one tab or its complete group and can place it again', () => {
    const state = emptyPaneLayout();
    const source = addPanePanel(state, panel('files'));
    addPanePanel(state, panel('tasks'), {
      referenceGroupId: source.id,
      direction: 'within',
    });
    const target = addPanePanel(state, panel('session'), {
      referenceGroupId: source.id,
      direction: 'right',
    });

    const detached = detachPanePanels(state, ['files']);
    expect(detached?.group.panels).toEqual(['files']);
    expect(findPaneGroup(state.root, source.id)?.panels).toEqual(['tasks']);
    placeDetachedPaneGroup(state, detached!.group, {
      referenceGroupId: target.id,
      direction: 'within',
    });
    expect(findPaneGroup(state.root, target.id)?.panels).toEqual(['session', 'files']);
  });

  it('calculates clamped geometry from panel minimum sizes', () => {
    const state = emptyPaneLayout();
    const files = addPanePanel(state, panel('files', 360));
    const projects = addPanePanel(state, panel('projects', 210), {
      referenceGroupId: files.id,
      direction: 'left',
      sizeRatio: 0.1,
    });
    const geometry = calculatePaneGeometry(state, { x: 0, y: 0, width: 1_000, height: 600 });

    expect(geometry.groups.get(projects.id)?.width).toBe(210);
    expect(geometry.groups.get(files.id)?.width).toBe(789);
  });

  it('allows an explicitly constrained split to share a smaller target rectangle', () => {
    const state = emptyPaneLayout();
    const session = addPanePanel(state, panel('session', 240));
    addPanePanel(state, panel('terminal', 120), {
      referenceGroupId: session.id,
      direction: 'left',
    });
    if (state.root?.type !== 'split') throw new Error('Expected a split root.');
    state.root.relaxed = true;

    const geometry = calculatePaneGeometry(state, { x: 0, y: 0, width: 240, height: 600 });
    const widths = [...geometry.groups.values()].map(({ width }) => width);
    expect(widths.reduce((total, width) => total + width, 1)).toBe(240);
  });

  it('validates that every panel occurs exactly once', () => {
    const valid: PaneLayoutState = {
      version: 1,
      panels: { files: panel('files') },
      root: paneGroup(['files'], 'files-group'),
      activePanelId: 'files',
    };
    expect(isPaneLayoutState(valid)).toBe(true);
    expect(
      isPaneLayoutState({
        ...valid,
        panels: { ...valid.panels, orphan: panel('orphan') },
      }),
    ).toBe(false);
  });
});
