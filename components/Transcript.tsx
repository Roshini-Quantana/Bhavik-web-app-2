export interface TranscriptMsg {
  speaker: 'agent' | 'user';
  text: string;
  final: boolean;
}

export default function Transcript({ messages }: { messages: TranscriptMsg[] }) {
  return (
    <div className="card transcript-card">
      <div className="card-header-inline">
        <span className="card-label">LIVE TRANSCRIPT</span>
        <span className="transcript-msgs">{messages.length} msgs</span>
      </div>
      <div className="transcript-content">
        {messages.length === 0 ? (
          <div className="transcript-empty">
            <span>Transcript will stream here</span>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`transcript-msg ${m.speaker}${m.final ? '' : ' interim'}`}>
              <span className="transcript-speaker">{m.speaker === 'agent' ? 'BHAVIK' : 'USER'}</span>
              <span className="transcript-text">{m.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
