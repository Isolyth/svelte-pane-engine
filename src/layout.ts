export type PaneAxis = 'horizontal' | 'vertical';
export type PaneDirection = 'above' | 'below' | 'left' | 'right' | 'within';

export interface PanePanelState {
  component: string;
  id: string;
  minimumHeight?: number;
  minimumWidth?: number;
  params?: Record<string, unknown>;
  title: string;
}

export interface PaneGroupNode {
  activePanelId: string;
  id: string;
  panels: string[];
  type: 'group';
}

export interface PaneSplitNode {
  axis: PaneAxis;
  first: PaneLayoutNode;
  id: string;
  ratio: number;
  /** Lets an explicitly target-constrained split share less than its children's summed minima. */
  relaxed?: boolean;
  second: PaneLayoutNode;
  type: 'split';
}

export type PaneLayoutNode = PaneGroupNode | PaneSplitNode;

export interface PaneLayoutState {
  activePanelId?: string;
  panels: Record<string, PanePanelState>;
  root?: PaneLayoutNode;
  version: 1;
}

export interface PanePosition {
  direction: PaneDirection;
  index?: number;
  referenceGroupId: string;
  /** Fraction of the target rectangle occupied by the inserted group. */
  sizeRatio?: number;
}

export interface PaneRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface PaneSplitGeometry {
  boundary: PaneRect;
  container: PaneRect;
}

export interface PaneGeometry {
  groups: Map<string, PaneRect>;
  splits: Map<string, PaneSplitGeometry>;
}

export interface DetachedPaneGroup {
  group: PaneGroupNode;
  sourceGroupId: string;
}

export interface PaneGroupPathStep {
  axis: PaneAxis;
  side: 'first' | 'second';
  splitId: string;
}

const minimumPanelWidth = 120;
const minimumPanelHeight = 80;

export function emptyPaneLayout(): PaneLayoutState {
  return { version: 1, panels: {} };
}

export function paneId(prefix: 'group' | 'split'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function paneGroup(panelIds: string[], id = paneId('group')): PaneGroupNode {
  if (!panelIds.length) throw new Error('A pane group must contain at least one panel.');
  return { type: 'group', id, panels: [...panelIds], activePanelId: panelIds[0] };
}

export function clonePaneLayout(state: PaneLayoutState): PaneLayoutState {
  return structuredClone(state);
}

export function paneGroups(root: PaneLayoutNode | undefined): PaneGroupNode[] {
  if (!root) return [];
  if (root.type === 'group') return [root];
  return [...paneGroups(root.first), ...paneGroups(root.second)];
}

export function findPaneGroup(
  root: PaneLayoutNode | undefined,
  groupId: string,
): PaneGroupNode | undefined {
  if (!root) return undefined;
  if (root.type === 'group') return root.id === groupId ? root : undefined;
  return findPaneGroup(root.first, groupId) ?? findPaneGroup(root.second, groupId);
}

export function groupContainingPanel(
  root: PaneLayoutNode | undefined,
  panelId: string,
): PaneGroupNode | undefined {
  return paneGroups(root).find(({ panels }) => panels.includes(panelId));
}

export function findPaneSplit(
  root: PaneLayoutNode | undefined,
  splitId: string,
): PaneSplitNode | undefined {
  if (!root || root.type === 'group') return undefined;
  if (root.id === splitId) return root;
  return findPaneSplit(root.first, splitId) ?? findPaneSplit(root.second, splitId);
}

export function paneGroupPath(
  root: PaneLayoutNode | undefined,
  groupId: string,
): PaneGroupPathStep[] | undefined {
  if (!root) return undefined;
  if (root.type === 'group') return root.id === groupId ? [] : undefined;
  const first = paneGroupPath(root.first, groupId);
  if (first) return [{ splitId: root.id, axis: root.axis, side: 'first' }, ...first];
  const second = paneGroupPath(root.second, groupId);
  return second ? [{ splitId: root.id, axis: root.axis, side: 'second' }, ...second] : undefined;
}

export function paneNodePath(
  root: PaneLayoutNode | undefined,
  nodeId: string,
): PaneGroupPathStep[] | undefined {
  if (!root) return undefined;
  if (root.id === nodeId) return [];
  if (root.type === 'group') return undefined;
  const first = paneNodePath(root.first, nodeId);
  if (first) return [{ splitId: root.id, axis: root.axis, side: 'first' }, ...first];
  const second = paneNodePath(root.second, nodeId);
  return second ? [{ splitId: root.id, axis: root.axis, side: 'second' }, ...second] : undefined;
}

export function insertPaneGroup(
  root: PaneLayoutNode | undefined,
  targetGroupId: string | undefined,
  inserted: PaneGroupNode,
  direction: Exclude<PaneDirection, 'within'> = 'right',
  sizeRatio = 0.5,
): PaneLayoutNode {
  if (!root) return inserted;
  const target = targetGroupId ? findPaneGroup(root, targetGroupId) : paneGroups(root)[0];
  if (!target) throw new Error(`Unknown target pane group: ${targetGroupId ?? '(none)'}`);

  const axis: PaneAxis = direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
  const insertedFirst = direction === 'left' || direction === 'above';
  const insertedShare = clampRatio(sizeRatio);
  const replacement: PaneSplitNode = {
    type: 'split',
    id: paneId('split'),
    axis,
    ratio: insertedFirst ? insertedShare : 1 - insertedShare,
    first: insertedFirst ? inserted : target,
    second: insertedFirst ? target : inserted,
  };
  return replacePaneNode(root, target.id, replacement);
}

export function addPanePanel(
  state: PaneLayoutState,
  panel: PanePanelState,
  position?: PanePosition,
): PaneGroupNode {
  if (state.panels[panel.id]) throw new Error(`Duplicate pane panel id: ${panel.id}`);
  state.panels[panel.id] = structuredClone(panel);

  if (position?.direction === 'within') {
    const target = findPaneGroup(state.root, position.referenceGroupId);
    if (!target) throw new Error(`Unknown target pane group: ${position.referenceGroupId}`);
    const index = Math.max(
      0,
      Math.min(target.panels.length, position.index ?? target.panels.length),
    );
    target.panels.splice(index, 0, panel.id);
    target.activePanelId = panel.id;
    state.activePanelId = panel.id;
    return target;
  }

  const group = paneGroup([panel.id]);
  state.root = insertPaneGroup(
    state.root,
    position?.referenceGroupId,
    group,
    position?.direction ?? 'right',
    position?.sizeRatio,
  );
  state.activePanelId = panel.id;
  return group;
}

export function removePanePanel(
  state: PaneLayoutState,
  panelId: string,
): PanePanelState | undefined {
  const panel = state.panels[panelId];
  const group = groupContainingPanel(state.root, panelId);
  if (!panel || !group) return undefined;

  group.panels.splice(group.panels.indexOf(panelId), 1);
  delete state.panels[panelId];
  if (!group.panels.length) state.root = removePaneGroup(state.root, group.id);
  else if (group.activePanelId === panelId) group.activePanelId = group.panels[0];
  if (state.activePanelId === panelId) {
    state.activePanelId = group.panels[0] ?? paneGroups(state.root)[0]?.activePanelId;
  }
  return panel;
}

export function detachPanePanels(
  state: PaneLayoutState,
  panelIds: readonly string[],
): DetachedPaneGroup | undefined {
  const selected = new Set(panelIds);
  const source = panelIds.length ? groupContainingPanel(state.root, panelIds[0]) : undefined;
  if (
    !source ||
    panelIds.some((id) => !source.panels.includes(id)) ||
    selected.size !== panelIds.length
  )
    return undefined;

  const ordered = source.panels.filter((id) => selected.has(id));
  if (ordered.length === source.panels.length) {
    state.root = removePaneGroup(state.root, source.id);
    return { group: source, sourceGroupId: source.id };
  }

  source.panels = source.panels.filter((id) => !selected.has(id));
  if (!source.panels.includes(source.activePanelId)) source.activePanelId = source.panels[0];
  const detached = paneGroup(ordered);
  if (state.activePanelId && selected.has(state.activePanelId)) {
    state.activePanelId = source.activePanelId;
  }
  return { group: detached, sourceGroupId: source.id };
}

export function placeDetachedPaneGroup(
  state: PaneLayoutState,
  detached: PaneGroupNode,
  position?: PanePosition,
): PaneGroupNode {
  if (!state.root) {
    state.root = detached;
  } else if (position?.direction === 'within') {
    const target = findPaneGroup(state.root, position.referenceGroupId);
    if (!target) throw new Error(`Unknown target pane group: ${position.referenceGroupId}`);
    const index = Math.max(
      0,
      Math.min(target.panels.length, position.index ?? target.panels.length),
    );
    target.panels.splice(index, 0, ...detached.panels);
    target.activePanelId = detached.activePanelId;
    state.activePanelId = detached.activePanelId;
    return target;
  } else {
    state.root = insertPaneGroup(
      state.root,
      position?.referenceGroupId,
      detached,
      position?.direction ?? 'right',
      position?.sizeRatio,
    );
  }
  state.activePanelId = detached.activePanelId;
  return detached;
}

export function setActivePanePanel(state: PaneLayoutState, panelId: string): boolean {
  const group = groupContainingPanel(state.root, panelId);
  if (!group) return false;
  group.activePanelId = panelId;
  state.activePanelId = panelId;
  return true;
}

export function calculatePaneGeometry(
  state: Pick<PaneLayoutState, 'panels' | 'root'>,
  bounds: PaneRect,
  gap = 1,
): PaneGeometry {
  const geometry: PaneGeometry = { groups: new Map(), splits: new Map() };
  if (state.root) calculateNodeGeometry(state.root, bounds, state.panels, geometry, gap);
  return geometry;
}

export function setPaneSplitRatio(
  root: PaneLayoutNode | undefined,
  splitId: string,
  ratio: number,
): boolean {
  const split = findPaneSplit(root, splitId);
  if (!split) return false;
  split.ratio = clampRatio(ratio);
  return true;
}

export function isPaneLayoutState(value: unknown): value is PaneLayoutState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.panels)) return false;
  const panels = value.panels as Record<string, unknown>;
  if (!Object.entries(panels).every(([id, panel]) => isPanel(panel, id))) return false;
  if (value.root === undefined) return Object.keys(panels).length === 0;

  const groupIds = new Set<string>();
  const splitIds = new Set<string>();
  const seenPanels = new Set<string>();
  if (!isNode(value.root, panels, groupIds, splitIds, seenPanels)) return false;
  if (seenPanels.size !== Object.keys(panels).length) return false;
  if (typeof value.activePanelId === 'string' && !seenPanels.has(value.activePanelId)) return false;
  return true;
}

function calculateNodeGeometry(
  node: PaneLayoutNode,
  bounds: PaneRect,
  panels: Record<string, PanePanelState>,
  geometry: PaneGeometry,
  gap: number,
): void {
  if (node.type === 'group') {
    geometry.groups.set(node.id, bounds);
    return;
  }

  const horizontal = node.axis === 'horizontal';
  const total = Math.max(0, (horizontal ? bounds.width : bounds.height) - gap);
  const firstMinimum = nodeMinimum(node.first, panels, gap)[horizontal ? 'width' : 'height'];
  const secondMinimum = nodeMinimum(node.second, panels, gap)[horizontal ? 'width' : 'height'];
  const preferred = total * clampRatio(node.ratio);
  const firstSize = constrainedFirstSize(total, preferred, firstMinimum, secondMinimum);
  const secondSize = Math.max(0, total - firstSize);
  const first: PaneRect = horizontal
    ? { ...bounds, width: firstSize }
    : { ...bounds, height: firstSize };
  const second: PaneRect = horizontal
    ? { ...bounds, x: bounds.x + firstSize + gap, width: secondSize }
    : { ...bounds, y: bounds.y + firstSize + gap, height: secondSize };
  const boundary: PaneRect = horizontal
    ? { x: bounds.x + firstSize, y: bounds.y, width: gap, height: bounds.height }
    : { x: bounds.x, y: bounds.y + firstSize, width: bounds.width, height: gap };
  geometry.splits.set(node.id, { boundary, container: bounds });
  calculateNodeGeometry(node.first, first, panels, geometry, gap);
  calculateNodeGeometry(node.second, second, panels, geometry, gap);
}

function nodeMinimum(
  node: PaneLayoutNode,
  panels: Record<string, PanePanelState>,
  gap: number,
): { height: number; width: number } {
  if (node.type === 'group') {
    return node.panels.reduce(
      (minimum, id) => ({
        width: Math.max(minimum.width, panels[id]?.minimumWidth ?? minimumPanelWidth),
        height: Math.max(minimum.height, panels[id]?.minimumHeight ?? minimumPanelHeight),
      }),
      { width: minimumPanelWidth, height: minimumPanelHeight },
    );
  }
  const first = nodeMinimum(node.first, panels, gap);
  const second = nodeMinimum(node.second, panels, gap);
  if (node.relaxed) {
    return {
      width: Math.max(first.width, second.width),
      height: Math.max(first.height, second.height),
    };
  }
  return node.axis === 'horizontal'
    ? { width: first.width + gap + second.width, height: Math.max(first.height, second.height) }
    : { width: Math.max(first.width, second.width), height: first.height + gap + second.height };
}

function constrainedFirstSize(
  total: number,
  preferred: number,
  firstMinimum: number,
  secondMinimum: number,
): number {
  if (firstMinimum + secondMinimum <= total) {
    return Math.max(firstMinimum, Math.min(total - secondMinimum, preferred));
  }
  const minimumTotal = firstMinimum + secondMinimum;
  return minimumTotal > 0 ? total * (firstMinimum / minimumTotal) : total / 2;
}

function replacePaneNode(
  node: PaneLayoutNode,
  nodeId: string,
  replacement: PaneLayoutNode,
): PaneLayoutNode {
  if (node.id === nodeId) return replacement;
  if (node.type === 'group') return node;
  const first = replacePaneNode(node.first, nodeId, replacement);
  if (first !== node.first) return { ...node, first };
  const second = replacePaneNode(node.second, nodeId, replacement);
  return second === node.second ? node : { ...node, second };
}

function removePaneGroup(
  node: PaneLayoutNode | undefined,
  groupId: string,
): PaneLayoutNode | undefined {
  if (!node) return undefined;
  if (node.type === 'group') return node.id === groupId ? undefined : node;
  const first = removePaneGroup(node.first, groupId);
  const second = removePaneGroup(node.second, groupId);
  if (!first) return second;
  if (!second) return first;
  if (first === node.first && second === node.second) return node;
  return { ...node, first, second };
}

function clampRatio(ratio = 0.5): number {
  return Math.max(0.05, Math.min(0.95, Number.isFinite(ratio) ? ratio : 0.5));
}

function isNode(
  value: unknown,
  panels: Record<string, unknown>,
  groupIds: Set<string>,
  splitIds: Set<string>,
  seenPanels: Set<string>,
): value is PaneLayoutNode {
  if (!isRecord(value) || typeof value.id !== 'string') return false;
  if (value.type === 'group') {
    if (groupIds.has(value.id) || !Array.isArray(value.panels) || !value.panels.length)
      return false;
    if (!value.panels.every((id) => typeof id === 'string' && panels[id] && !seenPanels.has(id)))
      return false;
    if (typeof value.activePanelId !== 'string' || !value.panels.includes(value.activePanelId))
      return false;
    groupIds.add(value.id);
    for (const id of value.panels) seenPanels.add(id);
    return true;
  }
  if (value.type !== 'split' || splitIds.has(value.id)) return false;
  if (value.axis !== 'horizontal' && value.axis !== 'vertical') return false;
  if (typeof value.ratio !== 'number' || !Number.isFinite(value.ratio)) return false;
  if (value.relaxed !== undefined && typeof value.relaxed !== 'boolean') return false;
  splitIds.add(value.id);
  return (
    isNode(value.first, panels, groupIds, splitIds, seenPanels) &&
    isNode(value.second, panels, groupIds, splitIds, seenPanels)
  );
}

function isPanel(value: unknown, id: string): value is PanePanelState {
  return (
    isRecord(value) &&
    value.id === id &&
    typeof value.component === 'string' &&
    typeof value.title === 'string' &&
    (value.params === undefined || isRecord(value.params)) &&
    optionalFinite(value.minimumWidth) &&
    optionalFinite(value.minimumHeight)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalFinite(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}
