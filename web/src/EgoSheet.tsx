import { useEffect, useRef } from "react";
import type { EgoGraphData } from "@cairn/shared";
import { apiJson } from "./api.js";

const EGO_NODE_TYPE_LABEL: Record<EgoGraphData["nodes"][number]["type"], string> = {
  resource: "리소스",
  person: "사람",
  event: "이벤트",
  task: "작업",
  thread: "스레드"
};

export async function loadEgoGraph(
  targetType: "resource" | "person",
  targetId: number
): Promise<EgoGraphData | null> {
  try {
    const body = await apiJson<{ ok: boolean; data?: EgoGraphData }>(
      `/api/relations/ego?targetType=${targetType}&targetId=${targetId}`
    );
    return body.ok ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}

// On-demand ego-graph bottom sheet. Read-only list view (no SVG/canvas).
// role=dialog + aria-modal, initial focus on close, Tab focus trap, Escape
// close, and focus return to the opener element on unmount.
export function EgoSheet({ graph, onClose }: { graph: EgoGraphData; onClose: () => void }) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    closeRef.current?.focus();
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        backdrop!.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    backdrop.addEventListener("keydown", onKeyDown);
    return () => {
      backdrop.removeEventListener("keydown", onKeyDown);
      // Restore focus to the element that opened the sheet.
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [onClose]);

  const neighbors = graph.nodes.filter((n) => n.id !== graph.center.id);

  return (
    <div
      ref={backdropRef}
      className="sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="작은 관계 보기"
        data-testid="ego-sheet"
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h2 className="eyebrow" style={{ margin: 0 }}>
            {graph.center.label}
            {graph.truncated && <span className="card-meta"> (일부만 표시)</span>}
          </h2>
          <button ref={closeRef} className="sheet-close" aria-label="닫기" onClick={onClose}>
            ✕
          </button>
        </div>
        <ul className="ego-sheet__nodes" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {neighbors.map((node) => {
            const edge = graph.edges.find(
              (e) =>
                (e.from === graph.center.id && e.to === node.id) ||
                (e.to === graph.center.id && e.from === node.id)
            );
            return (
              <li key={node.id} className="ego-sheet__node" data-testid="ego-node">
                <span className="card-meta" style={{ opacity: 0.7 }}>{EGO_NODE_TYPE_LABEL[node.type]}</span>{" "}
                {node.href ? <a href={node.href}>{node.label}</a> : <span>{node.label}</span>}
                {node.sublabel && <span className="card-meta"> · {node.sublabel}</span>}
                {edge && (
                  <span className={`resource-firmness resource-firmness--${edge.firmness}`} style={{ marginLeft: "6px" }}>
                    {edge.firmness}
                  </span>
                )}
                {edge?.reason && <span className="card-meta" data-testid="ego-edge-reason"> — {edge.reason}</span>}
              </li>
            );
          })}
          {neighbors.length === 0 && (
            <li className="card-meta" style={{ opacity: 0.6 }}>연결된 항목 없음</li>
          )}
        </ul>
      </div>
    </div>
  );
}
