import type { ReactNode } from "react";

// Creation result card (cycle-68). Presentational only: data-in / callbacks-out,
// no network or navigation inside. Used for "what was created / where it lives /
// next useful action" feedback across the creation surfaces (/input, /threads/new,
// /watch). The primary action is a link when `href` is set, else a button.
export type ResultCardAction = { label: string; href?: string; onClick?: () => void; testId?: string };

export function ResultCard({
  kind,
  title,
  status,
  primary,
  secondary,
  testId
}: {
  kind: string;
  title?: string;
  status: string;
  primary: ResultCardAction;
  secondary?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="result-card" role="status" aria-live="polite" data-testid={testId}>
      <p className="result-card-head">
        <span className="result-card-kind">{kind}</span>
        {title && <span className="result-card-title">{title}</span>}
      </p>
      <p className="result-card-status">{status}</p>
      {primary.href ? (
        <a className="result-card-action" href={primary.href} data-testid={primary.testId}>
          {primary.label}
        </a>
      ) : (
        <button type="button" className="result-card-action" onClick={primary.onClick} data-testid={primary.testId}>
          {primary.label}
        </button>
      )}
      {secondary != null && <div className="result-card-secondary">{secondary}</div>}
    </div>
  );
}
