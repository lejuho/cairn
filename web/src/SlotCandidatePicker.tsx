import type { SlotCandidate } from "@cairn/shared";

function formatSlotRange(candidate: SlotCandidate): string {
  return `${candidate.start.slice(0, 10)} ${candidate.start.slice(11, 16)} - ${candidate.end.slice(11, 16)}`;
}

export function SlotCandidatePicker({
  candidates,
  emptyMessage,
  onPick,
  testIdPrefix
}: {
  candidates: SlotCandidate[];
  emptyMessage: string;
  onPick: (candidate: SlotCandidate) => void;
  testIdPrefix?: string;
}) {
  if (candidates.length === 0) {
    return <p className="today-slot-empty">{emptyMessage}</p>;
  }

  return (
    <ul className="today-slot-list" role="list">
      {candidates.map((candidate) => (
        <li key={candidate.start} className="today-slot-item">
          <button
            type="button"
            className="today-slot-candidate"
            onClick={() => onPick(candidate)}
            aria-label={`${formatSlotRange(candidate)} 선택`}
            data-testid={testIdPrefix ? `${testIdPrefix}-${candidate.rank}` : undefined}
          >
            <span className="today-slot-time">{formatSlotRange(candidate)}</span>
            <span className="today-slot-score-label">{candidate.scoreLabel}</span>
          </button>
          {candidate.reasons.length > 0 && (
            <ul className="today-slot-reasons" role="list" aria-label="추천 이유">
              {candidate.reasons.slice(0, 3).map((reason) => (
                <li key={reason} className="today-slot-reason today-slot-reason--neutral">
                  <span className="today-slot-reason-text">{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
