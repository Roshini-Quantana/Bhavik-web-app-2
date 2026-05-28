export interface StreamEntry {
  ts: string;
  text: string;
  kind: 'info' | 'ok' | 'warn' | 'err';
}

export default function StreamPanel({ entries }: { entries: StreamEntry[] }) {
  return (
    <div className="card stream-card">
      <div className="card-header-inline">
        <span className="stream-dot"></span>
        <span className="card-label stream-label">AI PROCESS STREAM</span>
      </div>
      <div className="stream-content">
        {entries.length === 0 ? (
          <div className="stream-line awaiting">… awaiting input…</div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`stream-line ${e.kind}`}>
              <span className="stream-ts">{e.ts}</span>
              {e.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
