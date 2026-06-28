import type { ReactNode } from "react";

// Shared creation Composer (cycle-70, extended cycle-71). Presentational only:
// data-in / callbacks-out. NO API calls, navigation, data fetching, or result
// construction — the owning page holds state, routes submits by mode, renders
// the success card / error, and supplies the optional `detail` slot (watcher
// subtype fields / record target selector). Used by /input (full) + /today.
export type ComposerMode = "event" | "thread" | "task" | "watcher" | "record";
export type ComposerModeConfig = { mode: ComposerMode; label: string; placeholder: string };

export function CreationComposer({
  mode,
  text,
  submitting,
  modes,
  onModeChange,
  onTextChange,
  onSubmit,
  title,
  compact,
  detail,
  submitDisabled
}: {
  mode: ComposerMode;
  text: string;
  submitting: boolean;
  modes: ComposerModeConfig[];
  onModeChange: (mode: ComposerMode) => void;
  onTextChange: (text: string) => void;
  onSubmit: () => void;
  title?: string;
  compact?: boolean;
  detail?: ReactNode;
  submitDisabled?: boolean;
}) {
  const meta = modes.find((m) => m.mode === mode);
  return (
    <section className={compact ? "composer composer--compact" : "input-section composer"}>
      {title && <h2 className="input-section-title">{title}</h2>}
      <div className="composer-modes" role="group" aria-label="만들기 종류">
        {modes.map((m) => (
          <button
            key={m.mode}
            type="button"
            className={`composer-mode${mode === m.mode ? " composer-mode--active" : ""}`}
            aria-pressed={mode === m.mode}
            data-mode={m.mode}
            onClick={() => onModeChange(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <form className="composer-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <textarea
          className="composer-input"
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={meta?.placeholder}
          rows={mode === "thread" ? 3 : 1}
          disabled={submitting}
          aria-label="만들기 입력"
        />
        {detail}
        <button
          type="submit"
          className="composer-submit"
          disabled={!text.trim() || submitting || submitDisabled}
          aria-label="만들기"
        >
          {submitting ? "…" : "만들기 →"}
        </button>
      </form>
    </section>
  );
}
