import { motionDuration, motionEasing, prefersReducedMotion } from './motion.js';

const tabSelector = '.pane-tab[data-tab-panel-id]';
const animationPrefix = 'pane-tab-';

interface TabPosition {
  left: number;
  top: number;
}

export function animateTabMutation(root: HTMLElement, update: () => void): void {
  if (prefersReducedMotion()) {
    update();
    return;
  }

  const before = tabPositions(root);
  update();
  for (const tab of root.querySelectorAll<HTMLElement>(tabSelector)) {
    const id = tab.dataset.tabPanelId;
    if (!id) continue;
    const content = tab.querySelector<HTMLElement>('.pane-tab-content') ?? tab;
    for (const animation of content.getAnimations()) {
      if (animation.id.startsWith(animationPrefix)) animation.cancel();
    }
    const previous = before.get(id);
    const current = tab.getBoundingClientRect();
    const frames = previous
      ? [
          {
            transform: `translate(${previous.left - current.left}px, ${previous.top - current.top}px)`,
          },
          { transform: 'translate(0, 0)' },
        ]
      : [
          { opacity: 0, transform: 'translateX(-9px)' },
          { opacity: 1, transform: 'translateX(0)' },
        ];
    const animation = content.animate(frames, {
      duration: motionDuration(tab, '--pane-motion-tab', 190),
      easing: motionEasing(tab, '--pane-easing', 'cubic-bezier(0.16, 0.84, 0.24, 1.08)'),
    });
    animation.id = `${animationPrefix}${previous ? 'shift' : 'enter'}`;
  }
}

function tabPositions(root: HTMLElement): Map<string, TabPosition> {
  return new Map(
    [...root.querySelectorAll<HTMLElement>(tabSelector)].flatMap((tab) => {
      const id = tab.dataset.tabPanelId;
      if (!id) return [];
      const { left, top } = tab.getBoundingClientRect();
      return [[id, { left, top }] as const];
    }),
  );
}
