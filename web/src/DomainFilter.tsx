import type { DomainFilter } from "@cairn/shared";

// Domain segmented control (cycle-67 FR-DOM-01). Presentational: value-in,
// onChange-out. Shared by /threads and /today. 44px touch targets + aria-pressed
// selected state are styled via .domain-seg in styles.css.
const LABELS: Record<DomainFilter, string> = { all: "전체", personal: "개인", work: "업무" };

export function domainLabel(d: DomainFilter): string {
  return LABELS[d];
}

export function DomainFilterControl({
  value,
  onChange,
  label = "도메인 필터"
}: {
  value: DomainFilter;
  onChange: (d: DomainFilter) => void;
  label?: string;
}) {
  return (
    <div className="domain-filter" role="group" aria-label={label}>
      {(["all", "personal", "work"] as const).map((d) => (
        <button
          key={d}
          type="button"
          className={`domain-seg${value === d ? " domain-seg--active" : ""}`}
          aria-pressed={value === d}
          data-domain={d}
          onClick={() => onChange(d)}
        >
          {LABELS[d]}
        </button>
      ))}
    </div>
  );
}
