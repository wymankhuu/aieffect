export function Sparkline({ points, width = 160, height = 40 }: { points: number[]; width?: number; height?: number }) {
  if (points.length === 0) return <svg width={width} height={height} />;
  const max = Math.max(1, ...points);
  const step = width / Math.max(1, points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${height - (p / max) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="text-[#1A1033]">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
