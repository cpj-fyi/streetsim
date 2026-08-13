export function clampRevealPosition(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function revealValueText(value: number): string {
  const today = clampRevealPosition(value);
  const edit = 100 - today;
  if (today === 0) return "Your edit";
  if (today === 100) return "Street today";
  return `Street today ${today}%. Your edit ${edit}%.`;
}
