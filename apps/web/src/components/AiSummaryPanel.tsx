import { BrainCircuit, CheckCircle2, SearchCheck, TriangleAlert } from 'lucide-react';

type AiSummary = {
  whyRisky?: string[];
  signalsMatter?: string[];
  verifyNext?: string[];
};

type AiSummaryPanelProps = {
  summary?: AiSummary | null;
  explanation?: string | null;
};

const sections = [
  { key: 'whyRisky', title: 'Why risky', icon: TriangleAlert },
  { key: 'signalsMatter', title: 'Signals that matter', icon: BrainCircuit },
  { key: 'verifyNext', title: 'What to verify next', icon: SearchCheck },
] as const;

const isDuplicateDecisionText = (value?: string | null) => {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized.startsWith('risk score:') || normalized.startsWith('this token is blocked');
};

export function AiSummaryPanel({ summary, explanation }: AiSummaryPanelProps) {
  const hasStructuredSummary = sections.some(({ key }) => summary?.[key]?.length);
  const fallbackExplanation = isDuplicateDecisionText(explanation) ? null : explanation;
  if (!hasStructuredSummary && !fallbackExplanation) return null;

  return (
    <section className="card ai-summary-panel">
      <div className="section-header">
        <div className="section-header__main">
          <span className="icon-shell"><BrainCircuit size={20} /></span>
          <div>
            <h3 className="section-header__title">AI scan summary</h3>
            <p className="section-header__description">Generated from engine outputs only. Scores and decisions stay deterministic.</p>
          </div>
        </div>
      </div>

      {hasStructuredSummary ? (
        <div className="ai-summary-grid">
          {sections.map(({ key, title, icon: Icon }) => {
            const items = summary?.[key] ?? [];
            if (items.length === 0) return null;

            return (
              <div className="ai-summary-section" key={key}>
                <div className="ai-summary-section__title"><Icon size={16} /> {title}</div>
                <ul>
                  {items.slice(0, 3).map((item, index) => (
                    <li key={`${key}-${index}`}><CheckCircle2 size={14} /> {item}</li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="ai-summary-fallback">{fallbackExplanation}</p>
      )}
    </section>
  );
}
