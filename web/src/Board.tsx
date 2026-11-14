import { createContext, useContext, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

// A state board: three coloured columns (할 일 / 진행 중 / 완료) that fill the screen width, with
// anything set aside folded underneath. Used for the items of one thread and for the list of threads.
// Columns scroll sideways with snapping when they do not fit (phones).
//
// Cards move between columns by dragging their grip (mouse or touch) or, with the grip focused,
// by the left/right arrow keys. The board only reports the move; the owner turns it into a real
// state change and reloads.

export type BoardColumnId = "todo" | "doing" | "done";
export type BoardPlace = BoardColumnId | "folded";
export type BoardMove = (cardKey: string, to: BoardColumnId) => void;

export const BOARD_COLUMNS: Array<{ id: BoardColumnId; label: string }> = [
  { id: "todo", label: "할 일" },
  { id: "doing", label: "진행 중" },
  { id: "done", label: "완료" }
];

const ORDER: BoardColumnId[] = ["todo", "doing", "done"];

const BoardContext = createContext<{ column: BoardPlace; onMove: BoardMove } | null>(null);

type GripProps = { cardKey: string; label: string };

// The handle a card is dragged by. Renders nothing on a board that does not accept moves.
export function BoardGrip({ cardKey, label }: GripProps) {
  const ctx = useContext(BoardContext);
  const drag = useRef<{ ghost: HTMLElement; card: HTMLElement; board: HTMLElement; dx: number; dy: number; over: HTMLElement | null } | null>(null);
  if (!ctx) return null;
  const { column, onMove } = ctx;

  const columnAt = (board: HTMLElement, x: number, y: number): HTMLElement | null => {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>(".kanban-col") ?? null;
    return hit && board.contains(hit) ? hit : null;
  };

  const finish = () => {
    const d = drag.current;
    if (!d) return;
    d.ghost.remove();
    d.card.removeAttribute("data-dragging");
    d.over?.removeAttribute("data-drop");
    d.board.removeAttribute("data-dragging");
    drag.current = null;
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const card = e.currentTarget.closest<HTMLElement>("li");
    const board = e.currentTarget.closest<HTMLElement>(".kanban");
    if (!card || !board) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = card.getBoundingClientRect();
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.classList.add("kanban-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    document.body.appendChild(ghost);
    card.setAttribute("data-dragging", "true");
    board.setAttribute("data-dragging", "true");
    drag.current = { ghost, card, board, dx: e.clientX - rect.left, dy: e.clientY - rect.top, over: null };
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    d.ghost.style.left = `${e.clientX - d.dx}px`;
    d.ghost.style.top = `${e.clientY - d.dy}px`;
    const over = columnAt(d.board, e.clientX, e.clientY);
    if (over !== d.over) {
      d.over?.removeAttribute("data-drop");
      over?.setAttribute("data-drop", "true");
      d.over = over;
    }
    // Near the edge of a board that scrolls sideways (phones), bring the next column into reach.
    const scroller = d.board.querySelector<HTMLElement>(".kanban-cols");
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (e.clientX > box.right - 48) scroller.scrollBy({ left: 14 });
      else if (e.clientX < box.left + 48) scroller.scrollBy({ left: -14 });
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const target = columnAt(d.board, e.clientX, e.clientY)?.dataset.column as BoardColumnId | undefined;
    finish();
    if (target && target !== column) onMove(cardKey, target);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    // From the folded pile either arrow brings the card back to the first column.
    const index = column === "folded" ? -1 : ORDER.indexOf(column);
    const next = index === -1 ? ORDER[0] : ORDER[index + (e.key === "ArrowRight" ? 1 : -1)];
    if (next) onMove(cardKey, next);
  };

  return (
    <button
      type="button"
      className="kanban-grip"
      aria-label={`${label} 옮기기`}
      title="끌어서 다른 열로 옮기기 (키보드: 좌우 화살표)"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true">⠿</span>
    </button>
  );
}

type BoardProps = {
  label: string;
  testId?: string;
  // Cards per column, already rendered as <li>. `count` drives the header and the empty state.
  columns: Record<BoardColumnId, { count: number; cards: ReactNode }>;
  folded?: { count: number; cards: ReactNode } | undefined;
  // Given, cards with a <BoardGrip> can be moved between columns.
  onMove?: BoardMove | undefined;
  // Short message about the last move (why it was refused, or that it failed).
  notice?: string | null | undefined;
};

// Finished work can be put away: the 완료 column shrinks to a narrow strip that still shows its
// count and still takes dropped cards. The choice is remembered for every board.
const DONE_COLLAPSED_KEY = "cairn.board.doneCollapsed";

function readDoneCollapsed(): boolean {
  try {
    return window.localStorage.getItem(DONE_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function Board({ label, testId, columns, folded, onMove, notice }: BoardProps) {
  const [doneCollapsed, setDoneCollapsed] = useState(readDoneCollapsed);
  const toggleDone = () => setDoneCollapsed((prev) => {
    try {
      window.localStorage.setItem(DONE_COLLAPSED_KEY, prev ? "0" : "1");
    } catch {
      // Storage unavailable: the choice still holds for this screen.
    }
    return !prev;
  });
  const within = (column: BoardPlace, children: ReactNode) =>
    onMove ? <BoardContext.Provider value={{ column, onMove }}>{children}</BoardContext.Provider> : children;

  return (
    <section className="kanban" aria-label={label} data-testid={testId}>
      {notice && <p className="kanban-notice" role="status">{notice}</p>}
      <div className="kanban-cols">
        {BOARD_COLUMNS.map((col) => {
          const { count, cards } = columns[col.id];
          const collapsed = col.id === "done" && doneCollapsed;
          return (
            <section key={col.id} className="kanban-col" data-tone={col.id} data-column={col.id} data-collapsed={collapsed ? "true" : undefined} aria-label={`${col.label} 열`}>
              <h2 className="kanban-col-head">
                <span className="kanban-dot" aria-hidden="true" />
                <span className="kanban-col-label">{col.label}</span>
                <span className="kanban-count" aria-label={`${count}개`}>{count}</span>
                {col.id === "done" && (
                  <button type="button" className="kanban-col-toggle" aria-expanded={!collapsed} aria-label={collapsed ? "완료 열 펼치기" : "완료 열 접기"} onClick={toggleDone}>
                    <span aria-hidden="true">{collapsed ? "‹" : "›"}</span>
                  </button>
                )}
              </h2>
              {collapsed ? null : count > 0 ? (
                <ul className="kanban-cards" role="list">{within(col.id, cards)}</ul>
              ) : (
                <div className="kanban-empty" aria-hidden="true" />
              )}
            </section>
          );
        })}
      </div>
      {folded && folded.count > 0 && (
        <details className="kanban-folded">
          <summary>접어둔 것 {folded.count}</summary>
          <ul className="kanban-cards" role="list">{within("folded", folded.cards)}</ul>
        </details>
      )}
    </section>
  );
}
