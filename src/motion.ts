export function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function motionDuration(
  element: Element,
  customProperty: `--${string}`,
  fallback: number,
): number {
  const value = getComputedStyle(element).getPropertyValue(customProperty).trim();
  const match = /^([\d.]+)(ms|s)$/.exec(value);
  if (!match) return fallback;
  const duration = Number.parseFloat(match[1]);
  return match[2] === 's' ? duration * 1_000 : duration;
}

export function motionEasing(
  element: Element,
  customProperty: `--${string}`,
  fallback: string,
): string {
  return getComputedStyle(element).getPropertyValue(customProperty).trim() || fallback;
}
