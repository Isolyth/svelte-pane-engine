import { PaneGeometryAnimator, type GeometryFrame } from './geometry.js';
import { motionDuration, prefersReducedMotion } from './motion.js';
import { animateTabMutation } from './tab-motion.js';
import {
  addPanePanel,
  calculatePaneGeometry,
  clonePaneLayout,
  detachPanePanels,
  emptyPaneLayout,
  findPaneGroup,
  findPaneSplit,
  groupContainingPanel,
  isPaneLayoutState,
  paneGroups,
  paneNodePath,
  placeDetachedPaneGroup,
  removePanePanel,
  setActivePanePanel,
  setPaneSplitRatio,
  type DetachedPaneGroup,
  type PaneDirection,
  type PaneGeometry,
  type PaneGroupNode,
  type PaneLayoutState,
  type PanePanelState,
  type PanePosition,
  type PaneRect,
  type PaneSplitNode,
} from './layout.js';

export type PanePlacementMode = 'reflow' | 'split-target';

export interface PaneDisposable {
  dispose(): void;
}

export interface PanePanelRenderer {
  readonly element: HTMLElement;
  dispose(): void;
  update(panel: PanePanelState, visible: boolean): void;
}

export interface PaneEngineOptions {
  createRenderer(panel: PanePanelState): PanePanelRenderer;
  motionDuration?: number;
}

export interface AddPanePanelOptions extends PanePanelState {
  inactive?: boolean;
  position?: PanePosition;
}

export interface PaneDropTarget {
  direction: PaneDirection;
  groupId: string;
}

export interface PaneDragSelection {
  group: PaneGroupNode;
  panelIds: string[];
  snapshot: PaneLayoutState;
  snapshotGeometry: PaneGeometry;
  sourceGroupId: string;
}

interface PaneGroupView {
  content: HTMLElement;
  element: HTMLElement;
  tabs: HTMLElement;
}

interface FloatingPaneGroup {
  group: PaneGroupNode;
  rect: PaneRect;
  selection: PaneDragSelection;
}

const groupSurface = (id: string) => `group:${id}`;
const splitSurface = (id: string) => `split:${id}`;

export class PaneEngine {
  readonly element = document.createElement('div');
  readonly #groupViews = new Map<string, PaneGroupView>();
  readonly #splitViews = new Map<string, HTMLElement>();
  readonly #renderers = new Map<string, { component: string; renderer: PanePanelRenderer }>();
  readonly #listeners = new Set<() => void>();
  readonly #resizeObserver: ResizeObserver;
  readonly #animator: PaneGeometryAnimator;
  #geometry: PaneGeometry = { groups: new Map(), splits: new Map() };
  #state = emptyPaneLayout();
  #floating?: FloatingPaneGroup;
  #disposed = false;

  constructor(
    readonly host: HTMLElement,
    private readonly options: PaneEngineOptions,
  ) {
    this.element.className = 'pane-layout';
    this.element.dataset.layoutEngine = 'pane';
    host.append(this.element);
    this.#animator = new PaneGeometryAnimator(
      (frame, active) => this.applyGeometry(frame, active),
      options.motionDuration ??
        motionDuration(document.documentElement, '--pane-motion-layout', 240),
    );
    this.#resizeObserver = new ResizeObserver(() => this.recalculate(true));
    this.#resizeObserver.observe(host);
    this.element.addEventListener('click', this.click, true);
    this.element.addEventListener('mousedown', this.activateFromPointer, true);
  }

  get state(): PaneLayoutState {
    return clonePaneLayout(this.#state);
  }

  get activeGroupId(): string | undefined {
    return this.#state.activePanelId
      ? groupContainingPanel(this.#state.root, this.#state.activePanelId)?.id
      : paneGroups(this.#state.root)[0]?.id;
  }

  get panelIds(): string[] {
    return Object.keys(this.#state.panels);
  }

  get groupIds(): string[] {
    return paneGroups(this.#state.root).map(({ id }) => id);
  }

  get dragging(): boolean {
    return Boolean(this.#floating);
  }

  toJSON(): PaneLayoutState {
    return this.state;
  }

  fromJSON(value: PaneLayoutState, warp = false): void {
    if (!isPaneLayoutState(value)) throw new TypeError('Invalid pane layout.');
    this.#floating = undefined;
    this.#state = clonePaneLayout(value);
    this.syncViews();
    this.recalculate(warp);
    this.emitChange();
  }

  clear(warp = false): void {
    this.#floating = undefined;
    this.#state = emptyPaneLayout();
    this.syncViews();
    this.recalculate(warp);
    this.emitChange();
  }

  addPanel(options: AddPanePanelOptions): PanePanelHandle {
    const { inactive, position, ...panel } = options;
    const tabMutation = position?.direction === 'within';
    this.mutate(
      () => {
        const group = addPanePanel(this.#state, panel, position);
        if (inactive) {
          const previous = group.panels.find((id) => id !== panel.id);
          if (previous) {
            group.activePanelId = previous;
            this.#state.activePanelId = previous;
          }
        }
      },
      { tabMutation },
    );
    return new PanePanelHandle(this, panel.id);
  }

  getPanel(panelId: string): PanePanelHandle | undefined {
    return this.#state.panels[panelId] ? new PanePanelHandle(this, panelId) : undefined;
  }

  getPanelState(panelId: string): PanePanelState | undefined {
    const panel = this.#state.panels[panelId];
    return panel ? structuredClone(panel) : undefined;
  }

  getGroup(groupId: string): PaneGroupNode | undefined {
    const group = findPaneGroup(this.#state.root, groupId);
    return group ? structuredClone(group) : undefined;
  }

  groupForPanel(panelId: string): PaneGroupNode | undefined {
    const group =
      groupContainingPanel(this.#state.root, panelId) ??
      (this.#floating?.group.panels.includes(panelId) ? this.#floating.group : undefined);
    return group ? structuredClone(group) : undefined;
  }

  groupElement(groupId: string): HTMLElement | undefined {
    return this.#groupViews.get(groupId)?.element;
  }

  splitElement(splitId: string): HTMLElement | undefined {
    return this.#splitViews.get(splitId);
  }

  split(splitId: string): PaneSplitNode | undefined {
    const split = findPaneSplit(this.#state.root, splitId);
    return split ? structuredClone(split) : undefined;
  }

  currentGroupRect(groupId: string): PaneRect | undefined {
    return this.#animator.current(groupSurface(groupId)) ?? this.#geometry.groups.get(groupId);
  }

  goalGroupRect(groupId: string): PaneRect | undefined {
    const rect = this.#geometry.groups.get(groupId);
    return rect ? { ...rect } : undefined;
  }

  splitGeometry(splitId: string) {
    const geometry = this.#geometry.splits.get(splitId);
    return geometry ? structuredClone(geometry) : undefined;
  }

  activatePanel(panelId: string): void {
    const group = groupContainingPanel(this.#state.root, panelId);
    if (!group || group.activePanelId === panelId) return;
    animateTabMutation(this.element, () => {
      setActivePanePanel(this.#state, panelId);
      this.syncViews();
    });
    this.emitChange();
  }

  closePanel(panelId: string): void {
    const group = groupContainingPanel(this.#state.root, panelId);
    if (!group) return;
    const closesGroup = group.panels.length === 1;
    const closingView = closesGroup ? this.#groupViews.get(group.id) : undefined;
    const update = () => {
      removePanePanel(this.#state, panelId);
      this.syncViews(closingView?.element);
      this.recalculate(false);
      this.emitChange();
    };
    if (closesGroup) {
      if (closingView) this.animateExit(closingView.element);
      update();
    } else {
      animateTabMutation(this.element, update);
    }
  }

  updatePanel(panelId: string, update: Partial<Pick<PanePanelState, 'params' | 'title'>>): void {
    const panel = this.#state.panels[panelId];
    if (!panel) return;
    Object.assign(panel, structuredClone(update));
    this.syncViews();
    this.emitChange();
  }

  setSplitRatio(splitId: string, ratio: number, transient = false): boolean {
    if (!setPaneSplitRatio(this.#state.root, splitId, ratio)) return false;
    this.recalculate(true);
    if (!transient) this.emitChange();
    return true;
  }

  finishDirectManipulation(): void {
    this.emitChange();
  }

  dropTargetAt(clientX: number, clientY: number): PaneDropTarget | undefined {
    if (!inside(this.host.getBoundingClientRect(), clientX, clientY)) return undefined;
    const hit = document.elementFromPoint(clientX, clientY);
    const hitGroup =
      hit instanceof Element
        ? hit.closest<HTMLElement>('.pane-group:not(.is-pane-floating)')?.dataset.paneGroupId
        : undefined;
    const groupId =
      (hitGroup && findPaneGroup(this.#state.root, hitGroup) ? hitGroup : undefined) ??
      nearestGroup(this.#geometry, this.host.getBoundingClientRect(), clientX, clientY);
    if (!groupId) return undefined;
    const group = this.#groupViews.get(groupId);
    if (!group) return undefined;
    return {
      groupId,
      direction: dropDirection(group.element.getBoundingClientRect(), clientX, clientY),
    };
  }

  positionAt(clientX: number, clientY: number): PanePosition | undefined {
    const target = this.dropTargetAt(clientX, clientY);
    return target ? { referenceGroupId: target.groupId, direction: target.direction } : undefined;
  }

  beginPanelDrag(
    panelIds: string[],
    clientX: number,
    clientY: number,
  ): PaneDragSelection | undefined {
    if (this.#floating) return undefined;
    const source = panelIds.length
      ? groupContainingPanel(this.#state.root, panelIds[0])
      : undefined;
    const sourceRect = source ? this.currentGroupRect(source.id) : undefined;
    if (!source || !sourceRect) return undefined;
    const snapshot = clonePaneLayout(this.#state);
    const snapshotGeometry = calculatePaneGeometry(snapshot, {
      x: 0,
      y: 0,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
    });
    const detached = detachPanePanels(this.#state, panelIds);
    if (!detached) return undefined;
    const rect = floatingRect(sourceRect, this.host.getBoundingClientRect(), clientX, clientY);
    const selection = this.dragSelection(detached, snapshot, snapshotGeometry);
    this.#floating = { group: detached.group, rect, selection };
    this.syncViews();
    this.recalculate(false);
    this.#animator.warp(groupSurface(detached.group.id), rect);
    this.#groupViews.get(detached.group.id)?.element.classList.add('is-pane-floating');
    return selection;
  }

  movePanelDrag(clientX: number, clientY: number): void {
    if (!this.#floating) return;
    const host = this.host.getBoundingClientRect();
    this.#floating.rect = {
      ...this.#floating.rect,
      x: clientX - host.left - this.#floating.rect.width / 2,
      y: clientY - host.top - this.#floating.rect.height / 2,
    };
    this.#animator.warp(groupSurface(this.#floating.group.id), this.#floating.rect);
  }

  finishPanelDrag(
    position: PanePosition | undefined,
    placementMode: PanePlacementMode = 'reflow',
  ): boolean {
    const floating = this.#floating;
    if (!floating) return false;
    if (!position || !findPaneGroup(this.#state.root, position.referenceGroupId)) {
      this.cancelPanelDrag();
      return false;
    }
    const initial = new Map([[groupSurface(floating.group.id), floating.rect]]);
    const priorSplits = new Set(collectSplits(this.#state.root).map(({ id }) => id));
    this.#floating = undefined;
    animateTabMutation(this.element, () => {
      placeDetachedPaneGroup(this.#state, floating.group, position);
      if (placementMode === 'split-target' && position.direction !== 'within') {
        const insertedSplit = collectSplits(this.#state.root).find(
          ({ id }) => !priorSplits.has(id),
        );
        const desired = floating.selection.snapshotGeometry.groups.get(position.referenceGroupId);
        if (insertedSplit && desired) {
          insertedSplit.relaxed = true;
          this.constrainNodeBounds(insertedSplit.id, desired);
        }
      }
      this.syncViews();
      this.recalculate(false, initial);
    });
    this.emitChange();
    return true;
  }

  cancelPanelDrag(): void {
    const floating = this.#floating;
    if (!floating) return;
    const initial = new Map([[groupSurface(floating.group.id), floating.rect]]);
    this.#floating = undefined;
    this.#state = floating.selection.snapshot;
    this.syncViews();
    this.recalculate(false, initial);
  }

  onDidLayoutChange(listener: () => void): PaneDisposable {
    this.#listeners.add(listener);
    return { dispose: () => this.#listeners.delete(listener) };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resizeObserver.disconnect();
    this.#animator.dispose();
    this.element.removeEventListener('click', this.click, true);
    this.element.removeEventListener('mousedown', this.activateFromPointer, true);
    for (const { renderer } of this.#renderers.values()) renderer.dispose();
    this.#renderers.clear();
    this.#groupViews.clear();
    this.#splitViews.clear();
    this.#listeners.clear();
    this.element.remove();
    document.documentElement.classList.remove('is-pane-layout-animating');
  }

  private mutate(update: () => void, options: { tabMutation?: boolean } = {}): void {
    const mutate = () => {
      update();
      this.syncViews();
      this.recalculate(false);
      this.emitChange();
    };
    if (options.tabMutation) animateTabMutation(this.element, mutate);
    else mutate();
  }

  private syncViews(preserve?: HTMLElement): void {
    const groups = [
      ...paneGroups(this.#state.root),
      ...(this.#floating ? [this.#floating.group] : []),
    ];
    const wantedGroups = new Set(groups.map(({ id }) => id));
    const wantedPanels = new Set(Object.keys(this.#state.panels));

    for (const panel of Object.values(this.#state.panels)) {
      const current = this.#renderers.get(panel.id);
      if (current?.component === panel.component) continue;
      current?.renderer.dispose();
      this.#renderers.set(panel.id, {
        component: panel.component,
        renderer: this.options.createRenderer(panel),
      });
    }

    for (const [panelId, current] of this.#renderers) {
      if (wantedPanels.has(panelId)) continue;
      current.renderer.dispose();
      this.#renderers.delete(panelId);
    }

    for (const group of groups) {
      const view = this.#groupViews.get(group.id) ?? this.createGroupView(group.id);
      this.syncGroup(view, group);
    }
    for (const [groupId, view] of this.#groupViews) {
      if (wantedGroups.has(groupId) || view.element === preserve) continue;
      view.element.remove();
      this.#groupViews.delete(groupId);
    }

    const splits = collectSplits(this.#state.root);
    const wantedSplits = new Set(splits.map(({ id }) => id));
    for (const split of splits) {
      if (this.#splitViews.has(split.id)) continue;
      const element = document.createElement('div');
      element.className = `pane-sash pane-sash-${split.axis}`;
      element.dataset.paneSplitId = split.id;
      element.dataset.paneAxis = split.axis;
      this.element.append(element);
      this.#splitViews.set(split.id, element);
    }
    for (const [splitId, element] of this.#splitViews) {
      if (wantedSplits.has(splitId)) continue;
      element.remove();
      this.#splitViews.delete(splitId);
    }
  }

  private createGroupView(groupId: string): PaneGroupView {
    const element = document.createElement('section');
    element.className = 'pane-group';
    element.dataset.paneGroupId = groupId;
    const header = document.createElement('header');
    header.className = 'pane-tabs';
    const tabs = document.createElement('div');
    tabs.className = 'pane-tabs-list';
    const content = document.createElement('div');
    content.className = 'pane-group-content';
    header.append(tabs);
    element.append(header, content);
    this.element.append(element);
    const view = { element, tabs, content };
    this.#groupViews.set(groupId, view);
    return view;
  }

  private syncGroup(view: PaneGroupView, group: PaneGroupNode): void {
    view.element.classList.toggle(
      'is-pane-active',
      group.panels.includes(this.#state.activePanelId ?? ''),
    );
    view.element.classList.toggle('is-pane-headerless', group.panels.length === 1);
    view.element.classList.toggle('is-pane-floating', this.#floating?.group.id === group.id);
    view.element.dataset.paneGroupId = group.id;

    const existingTabs = new Map(
      [...view.tabs.querySelectorAll<HTMLElement>(':scope > .pane-tab')].map((tab) => [
        tab.dataset.tabPanelId ?? '',
        tab,
      ]),
    );
    for (const panelId of group.panels) {
      const panel = this.#state.panels[panelId];
      const current = this.#renderers.get(panelId)?.renderer;
      if (!panel || !current) continue;
      const tab = existingTabs.get(panelId) ?? createTab(panel);
      existingTabs.delete(panelId);
      tab.classList.toggle('pane-tab-active', group.activePanelId === panelId);
      tab.querySelector<HTMLElement>('.pane-tab-title')!.textContent = panel.title;
      view.tabs.append(tab);
      current.element.classList.add('pane-panel');
      current.element.dataset.panePanelId = panel.id;
      view.content.append(current.element);
      const visible = group.activePanelId === panelId;
      current.element.hidden = !visible;
      current.element.classList.toggle('is-headerless', group.panels.length === 1);
      current.update(panel, visible);
    }
    for (const stale of existingTabs.values()) stale.remove();
  }

  private recalculate(warp: boolean, initial?: ReadonlyMap<string, PaneRect>): void {
    if (this.#disposed) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (width <= 0 || height <= 0) return;
    this.#geometry = calculatePaneGeometry(this.#state, { x: 0, y: 0, width, height }, 1);
    const targets = new Map<string, PaneRect>();
    for (const [id, rect] of this.#geometry.groups) targets.set(groupSurface(id), rect);
    for (const [id, { boundary }] of this.#geometry.splits) targets.set(splitSurface(id), boundary);
    if (this.#floating) targets.set(groupSurface(this.#floating.group.id), this.#floating.rect);
    this.#animator.target(targets, {
      initial,
      warp: warp || prefersReducedMotion(),
    });
  }

  private applyGeometry(frame: GeometryFrame, active: boolean): void {
    document.documentElement.classList.toggle('is-pane-layout-animating', active);
    this.element.dataset.animating = String(active);
    for (const [id, view] of this.#groupViews) {
      const rect = frame.get(groupSurface(id));
      if (rect) applyRect(view.element, rect);
    }
    for (const [id, element] of this.#splitViews) {
      const rect = frame.get(splitSurface(id));
      if (rect) applyRect(element, expandedSash(rect));
    }
  }

  private dragSelection(
    detached: DetachedPaneGroup,
    snapshot: PaneLayoutState,
    snapshotGeometry: PaneGeometry,
  ): PaneDragSelection {
    return {
      group: detached.group,
      panelIds: [...detached.group.panels],
      snapshot,
      snapshotGeometry,
      sourceGroupId: detached.sourceGroupId,
    };
  }

  private constrainNodeBounds(nodeId: string, desired: PaneRect): void {
    const path = paneNodePath(this.#state.root, nodeId);
    if (!path) return;
    for (let pass = 0; pass < 2; pass += 1) {
      const geometry = calculatePaneGeometry(
        this.#state,
        { x: 0, y: 0, width: this.host.clientWidth, height: this.host.clientHeight },
        1,
      );
      for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
        const horizontal = edge === 'left' || edge === 'right';
        const side = edge === 'left' || edge === 'top' ? 'second' : 'first';
        const step = [...path]
          .reverse()
          .find(
            (candidate) =>
              candidate.axis === (horizontal ? 'horizontal' : 'vertical') &&
              candidate.side === side,
          );
        if (!step) continue;
        const split = findPaneSplit(this.#state.root, step.splitId);
        const splitGeometry = geometry.splits.get(step.splitId);
        if (!split || !splitGeometry) continue;
        const container = splitGeometry.container;
        const start = horizontal ? container.x : container.y;
        const available = Math.max(1, (horizontal ? container.width : container.height) - 1);
        const coordinate =
          edge === 'left'
            ? desired.x - 1
            : edge === 'right'
              ? desired.x + desired.width
              : edge === 'top'
                ? desired.y - 1
                : desired.y + desired.height;
        setPaneSplitRatio(this.#state.root, step.splitId, (coordinate - start) / available);
      }
    }
  }

  private animateExit(element: HTMLElement): void {
    if (prefersReducedMotion()) return;
    element.classList.add('is-pane-exiting');
    const animation = element.animate(
      [
        { opacity: 1, transform: element.style.transform },
        { opacity: 0, transform: `${element.style.transform} scale(0.96)` },
      ],
      {
        duration:
          this.options.motionDuration ?? motionDuration(element, '--pane-motion-layout', 240),
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
      },
    );
    animation.id = 'pane-group-exit';
    void animation.finished
      .catch(() => undefined)
      .finally(() => {
        element.remove();
        const groupId = element.dataset.paneGroupId;
        if (groupId && this.#groupViews.get(groupId)?.element === element) {
          this.#groupViews.delete(groupId);
        }
      });
  }

  private emitChange(): void {
    for (const listener of this.#listeners) listener();
  }

  private click = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : undefined;
    const tab = target?.closest<HTMLElement>('.pane-tab[data-tab-panel-id]');
    const panelId = tab?.dataset.tabPanelId;
    if (!panelId) return;
    if (target?.closest('.pane-tab-close')) {
      event.preventDefault();
      event.stopPropagation();
      this.closePanel(panelId);
    } else {
      this.activatePanel(panelId);
    }
  };

  private activateFromPointer = (event: MouseEvent): void => {
    if (event.button !== 0 && event.button !== 2) return;
    const target = event.target instanceof Element ? event.target : undefined;
    const panelId =
      target?.closest<HTMLElement>('.pane-tab[data-tab-panel-id]')?.dataset.tabPanelId ??
      target?.closest<HTMLElement>('.pane-panel[data-pane-panel-id]')?.dataset.panePanelId;
    if (panelId) this.activatePanel(panelId);
  };
}

export class PanePanelHandle {
  constructor(
    private readonly engine: PaneEngine,
    readonly id: string,
  ) {}

  get state(): PanePanelState | undefined {
    return this.engine.getPanelState(this.id);
  }

  get groupId(): string | undefined {
    return this.engine.groupForPanel(this.id)?.id;
  }

  close(): void {
    this.engine.closePanel(this.id);
  }

  setActive(): void {
    this.engine.activatePanel(this.id);
  }

  updateParameters(params: Record<string, unknown>): void {
    this.engine.updatePanel(this.id, { params });
  }

  setTitle(title: string): void {
    this.engine.updatePanel(this.id, { title });
  }
}

function createTab(panel: PanePanelState): HTMLElement {
  const tab = document.createElement('button');
  tab.className = 'pane-tab';
  tab.type = 'button';
  tab.dataset.tabPanelId = panel.id;
  tab.setAttribute('role', 'tab');
  const content = document.createElement('span');
  content.className = 'pane-tab-content';
  const title = document.createElement('span');
  title.className = 'pane-tab-title';
  title.textContent = panel.title;
  const close = document.createElement('span');
  close.className = 'pane-tab-close';
  close.setAttribute('role', 'button');
  close.setAttribute('aria-label', `Close ${panel.title}`);
  close.textContent = '×';
  content.append(title, close);
  tab.append(content);
  return tab;
}

function collectSplits(node: PaneLayoutState['root']): PaneSplitNode[] {
  if (!node || node.type === 'group') return [];
  return [node, ...collectSplits(node.first), ...collectSplits(node.second)];
}

function applyRect(element: HTMLElement, rect: PaneRect): void {
  element.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`;
  element.style.width = `${Math.max(0, rect.width)}px`;
  element.style.height = `${Math.max(0, rect.height)}px`;
  element.dataset.paneX = String(rect.x);
  element.dataset.paneY = String(rect.y);
  element.dataset.paneWidth = String(rect.width);
  element.dataset.paneHeight = String(rect.height);
}

function expandedSash(rect: PaneRect): PaneRect {
  return rect.width <= rect.height
    ? { x: rect.x - 3, y: rect.y, width: Math.max(7, rect.width + 6), height: rect.height }
    : { x: rect.x, y: rect.y - 3, width: rect.width, height: Math.max(7, rect.height + 6) };
}

function floatingRect(source: PaneRect, host: DOMRect, clientX: number, clientY: number): PaneRect {
  const width = Math.min(host.width, Math.max(180, source.width * 0.8489));
  const height = Math.min(host.height, Math.max(120, source.height * 0.8489));
  return {
    x: clientX - host.left - width / 2,
    y: clientY - host.top - height / 2,
    width,
    height,
  };
}

function nearestGroup(
  geometry: PaneGeometry,
  host: DOMRect,
  clientX: number,
  clientY: number,
): string | undefined {
  const x = clientX - host.left;
  const y = clientY - host.top;
  let nearest: { distance: number; id: string } | undefined;
  for (const [id, rect] of geometry.groups) {
    const dx = Math.max(rect.x - x, 0, x - rect.x - rect.width);
    const dy = Math.max(rect.y - y, 0, y - rect.y - rect.height);
    const distance = Math.hypot(dx, dy);
    if (!nearest || distance < nearest.distance) nearest = { id, distance };
  }
  return nearest?.id;
}

function dropDirection(bounds: DOMRect, x: number, y: number): PaneDirection {
  const rx = Math.max(0, Math.min(1, (x - bounds.left) / Math.max(1, bounds.width)));
  const ry = Math.max(0, Math.min(1, (y - bounds.top) / Math.max(1, bounds.height)));
  if (rx >= 0.25 && rx <= 0.75 && ry >= 0.25 && ry <= 0.75) return 'within';
  return Math.min(rx, 1 - rx) < Math.min(ry, 1 - ry)
    ? rx < 0.5
      ? 'left'
      : 'right'
    : ry < 0.5
      ? 'above'
      : 'below';
}

function inside(bounds: DOMRect, x: number, y: number): boolean {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}
