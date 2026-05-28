interface Props {
  turns: number;
  durationSec: number;
}

export default function StatsBar({ turns, durationSec }: Props) {
  const m = Math.floor(durationSec / 60);
  const s = String(durationSec % 60).padStart(2, '0');
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <div className="stat-value">{turns}</div>
        <span className="stat-label">turns</span>
      </div>
      <div className="stat-divider"></div>
      <div className="stat-item">
        <div className="stat-value timer">{m}:{s}</div>
        <span className="stat-label">duration</span>
      </div>
    </div>
  );
}
