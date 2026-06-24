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

const EGO_EDGE_KIND_LABEL: Record<EgoGraphData["edges"][number]["kind"], string> = {
  resource_link: "리소스 연결",
  source_person: "출처",
  event_people: "참여",
  thread_link: "스레드 연결"
};

const EGO_RELATION_KIND_LABEL: Record<NonNullable<EgoGraphData["edges"][number]["relationKind"]>, string> = {
  contains: "포함",
  blocks: "차단",
  feeds: "연결",
  competes: "경쟁",
  shares: "공유"
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
    // Escape is bound at the document level so it fires regardless of which
    // element inside the sheet holds focus (more robust than a backdrop-only
    // listener). Tab focus-trap stays scoped to the backdrop.
    function onDocKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    }
    function onBackdropKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const backdrop = backdropRef.current;
      if (!backdrop) return;
      const focusable = Array.from(
        backdrop.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')
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
    document.addEventListener("keydown", onDocKeyDown);
    const backdrop = backdropRef.current;
    backdrop?.addEventListener("keydown", onBackdropKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocKeyDown);
      backdrop?.removeEventListener("keydown", onBackdropKeyDown);
      // Restore focus to the element that opened the sheet.
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, [onClose]);

  const neighbors = graph.nodes.filter((n) => n.id !== graph.center.id);
  // Includes center so edge endpoints (center-to-neighbor and neighbor-to-neighbor) resolve.
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const labelFor = (id: string) => nodeById.get(id)?.label ?? id;

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
        <h3 className="eyebrow" style={{ margin: "0 0 6px" }}>항목</h3>
        <ul className="ego-sheet__nodes" style={{ listStyle: "none", padding: 0, margin: "0 0 16px" }}>
          {neighbors.map((node) => (
            <li key={node.id} className="ego-sheet__node" data-testid="ego-node">
              <span className="card-meta" style={{ opacity: 0.7 }}>{EGO_NODE_TYPE_LABEL[node.type]}</span>{" "}
              {node.href ? <a href={node.href}>{node.label}</a> : <span>{node.label}</span>}
              {node.sublabel && <span className="card-meta"> · {node.sublabel}</span>}
            </li>
          ))}
          {neighbors.length === 0 && (
            <li className="card-meta" style={{ opacity: 0.6 }}>연결된 항목 없음</li>
          )}
        </ul>

        <h3 className="eyebrow" style={{ margin: "0 0 6px" }}>관계</h3>
        <ul className="ego-sheet__edges" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {graph.edges.map((edge, i) => (
            <li key={`${edge.from}->${edge.to}-${i}`} className="ego-sheet__edge" data-testid="ego-edge">
              <span>{labelFor(edge.from)}</span>
              <span className="card-meta" style={{ margin: "0 4px" }}>→</span>
              <span>{labelFor(edge.to)}</span>{" "}
              <span className="card-meta" style={{ opacity: 0.7 }}>
                {EGO_EDGE_KIND_LABEL[edge.kind]}
                {edge.relationKind && ` · ${EGO_RELATION_KIND_LABEL[edge.relationKind]}`}
              </span>
              <span className={`resource-firmness resource-firmness--${edge.firmness}`} style={{ marginLeft: "6px" }}>
                {edge.firmness}
              </span>
              {edge.reason && <span className="card-meta" data-testid="ego-edge-reason"> — {edge.reason}</span>}
            </li>
          ))}
          {graph.edges.length === 0 && (
            <li className="card-meta" style={{ opacity: 0.6 }}>표시할 관계 없음</li>
          )}
        </ul>
      </div>
    </div>
  );
}
