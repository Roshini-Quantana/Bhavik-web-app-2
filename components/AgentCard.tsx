interface Props {
  statusText: string;
  active: boolean;
}

export default function AgentCard({ statusText, active }: Props) {
  return (
    <section className={`card agent-card${active ? ' active' : ''}`}>
      <div className="agent-avatar">B</div>
      <div className="agent-info">
        <div className="agent-name">Bhavik</div>
        <div className="agent-status-line">
          <span className="agent-role">AI Cold Caller</span>
          <span className="agent-sep">·</span>
          <span className="agent-ready">{statusText}</span>
        </div>
      </div>
      <div className="agent-pulse"></div>
    </section>
  );
}
