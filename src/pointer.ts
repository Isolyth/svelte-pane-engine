import type { PaneDropTarget, PaneEngine, PanePlacementMode } from './engine.js';

interface PendingDrag {
  active: boolean;
  panelIds: string[];
  startX: number;
  startY: number;
}

interface PendingResize {
  available: number;
  axis: 'horizontal' | 'vertical';
  initialRatio: number;
  splitId: string;
  start: number;
}

export interface PanePointerOptions {
  placementMode?: PanePlacementMode;
}

const previewClasses = [
  'is-pane-drop-target',
  'pane-drop-within',
  'pane-drop-left',
  'pane-drop-right',
  'pane-drop-above',
  'pane-drop-below',
];

export function installPanePointerController(
  engine: PaneEngine,
  options: PanePointerOptions = {},
): () => void {
  let drag: PendingDrag | undefined;
  let resize: PendingResize | undefined;
  let preview: PaneDropTarget | undefined;

  const clearPreview = (): void => {
    if (preview) engine.groupElement(preview.groupId)?.classList.remove(...previewClasses);
    preview = undefined;
  };

  const showPreview = (target?: PaneDropTarget): void => {
    if (target?.groupId === preview?.groupId && target?.direction === preview?.direction) return;
    clearPreview();
    if (!target) return;
    preview = target;
    engine
      .groupElement(target.groupId)
      ?.classList.add('is-pane-drop-target', `pane-drop-${target.direction}`);
  };

  const mouseDown = (event: MouseEvent): void => {
    if (drag || resize || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : undefined;
    const sash = target?.closest<HTMLElement>('.pane-sash[data-pane-split-id]');
    const splitId = sash?.dataset.paneSplitId;
    if (splitId) {
      const split = engine.split(splitId);
      const geometry = engine.splitGeometry(splitId);
      if (!split || !geometry) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const horizontal = split.axis === 'horizontal';
      resize = {
        available: Math.max(
          1,
          (horizontal ? geometry.container.width : geometry.container.height) - 1,
        ),
        axis: split.axis,
        initialRatio: split.ratio,
        splitId,
        start: horizontal ? event.clientX : event.clientY,
      };
      return;
    }

    const tab = target?.closest<HTMLElement>('.pane-tab[data-tab-panel-id]');
    if (tab && target?.closest('.pane-tab-close')) return;
    const handle = target?.closest<HTMLElement>('[data-pane-drag-handle]');
    if (!tab && !handle) return;
    const panelId =
      tab?.dataset.tabPanelId ??
      handle?.closest<HTMLElement>('.pane-panel[data-pane-panel-id]')?.dataset.panePanelId;
    const group = panelId ? engine.groupForPanel(panelId) : undefined;
    if (!panelId || !group) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag = {
      active: false,
      panelIds: event.shiftKey ? group.panels : [panelId],
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const mouseMove = (event: MouseEvent): void => {
    if (resize) {
      event.preventDefault();
      const current = resize.axis === 'horizontal' ? event.clientX : event.clientY;
      engine.setSplitRatio(
        resize.splitId,
        resize.initialRatio + (current - resize.start) / resize.available,
        true,
      );
      return;
    }
    if (!drag) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5)
      return;
    event.preventDefault();
    if (!drag.active) {
      drag.active = Boolean(engine.beginPanelDrag(drag.panelIds, event.clientX, event.clientY));
      if (!drag.active) return;
      engine.element.classList.add('is-pane-dragging');
    }
    engine.movePanelDrag(event.clientX, event.clientY);
    showPreview(engine.dropTargetAt(event.clientX, event.clientY));
  };

  const mouseUp = (event: MouseEvent): void => {
    if (resize) {
      resize = undefined;
      engine.finishDirectManipulation();
      return;
    }
    const finished = drag;
    drag = undefined;
    engine.element.classList.remove('is-pane-dragging');
    clearPreview();
    if (!finished?.active) return;
    event.preventDefault();
    engine.finishPanelDrag(
      engine.positionAt(event.clientX, event.clientY),
      options.placementMode ?? 'reflow',
    );
  };

  const cancel = (): void => {
    drag = undefined;
    resize = undefined;
    clearPreview();
    engine.element.classList.remove('is-pane-dragging');
    engine.cancelPanelDrag();
  };

  const keyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') cancel();
  };

  window.addEventListener('mousedown', mouseDown, true);
  window.addEventListener('mousemove', mouseMove, true);
  window.addEventListener('mouseup', mouseUp, true);
  window.addEventListener('blur', cancel);
  window.addEventListener('keydown', keyDown, true);
  return () => {
    window.removeEventListener('mousedown', mouseDown, true);
    window.removeEventListener('mousemove', mouseMove, true);
    window.removeEventListener('mouseup', mouseUp, true);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', keyDown, true);
    cancel();
  };
}
