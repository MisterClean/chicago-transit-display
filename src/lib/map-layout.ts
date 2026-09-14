export type LabelPoint = { id: string; x: number; y: number; width: number; height: number };
export type MapLabel = LabelPoint & { left: number; top: number; compact: boolean };

/** Place labels near their real coordinates, preserving clear geographic leader lines. */
export function placeMapLabels(points: LabelPoint[], width: number, height: number, obstacles: { x: number; y: number; radius: number }[] = []): MapLabel[] {
  const placed: MapLabel[] = [];
  const blocked = [...obstacles, ...points.map(p => ({ x: p.x, y: p.y, radius: 8 }))];
  for (const point of points) {
    const findPosition = (w: number, h: number) => {
      let best: { left: number; top: number; score: number } | undefined;
      for (let top = 66; top <= height - h - 35; top += 20) {
        for (let left = 12; left <= width - w - 12; left += 20) {
          if (blocked.some(p => left < p.x + p.radius && left + w > p.x - p.radius && top < p.y + p.radius && top + h > p.y - p.radius)) continue;
          if (placed.some(p => left < p.left + p.width + 10 && left + w + 10 > p.left && top < p.top + p.height + 10 && top + h + 10 > p.top)) continue;
          const dx = Math.max(left - point.x, 0, point.x - left - w);
          const dy = Math.max(top - point.y, 0, point.y - top - h);
          const score = Math.hypot(dx, dy) + Math.hypot(left + w / 2 - point.x, top + h / 2 - point.y) * .1;
          if (!best || score < best.score) best = { left, top, score };
        }
      }
      return best;
    };
    const full = findPosition(point.width, point.height);
    const compact = !full;
    const position = full ?? findPosition(44, 44);
    placed.push({ ...point, width: compact ? 44 : point.width, height: compact ? 44 : point.height, left: position?.left ?? 12, top: position?.top ?? 66, compact });
  }
  return placed;
}
