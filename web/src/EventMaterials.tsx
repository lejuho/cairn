import { useCallback, useEffect, useState } from "react";
import type { EventMaterialView } from "@cairn/shared";
import { apiJson } from "./api.js";

type Kind = EventMaterialView["kind"];

const KIND_LABEL: Record<Kind, string> = {
  slides: "발표자료",
  video: "다시보기",
  recording: "녹음",
  notes: "메모",
  photo: "사진",
  link: "링크",
  file: "파일"
};

const ADD_KINDS: Kind[] = ["slides", "video", "recording", "link", "photo", "file", "notes"];

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(new Date(iso));
}

function statusText(m: EventMaterialView): string {
  if (m.status === "available") return "";
  if (m.status === "expected") return m.expectedAt ? `${shortDate(m.expectedAt)} 공개 예정` : "공개 예정";
  return m.missingReason === "auto_expired" ? "확인 못 함 (자동 정리)" : "공개 안 함";
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiJson<ApiResponse<T>>(url, init);
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// 일정 상세 시트의 자료 섹션. 일정이 남긴 결과물(슬라이드·다시보기 등) 링크를 보여주고 붙인다.
// 처음 목록은 일정 상세 응답(initial)으로 받고, 붙이거나 고친 뒤에만 자체적으로 다시 불러온다.
export function EventMaterials({ eventId, initial }: { eventId: number; initial: EventMaterialView[] }) {
  const [materials, setMaterials] = useState<EventMaterialView[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<{ kind: Kind; url: string; label: string; submitting: boolean }>({
    kind: "slides", url: "", label: "", submitting: false
  });
  const [fillId, setFillId] = useState<number | null>(null);
  const [fillUrl, setFillUrl] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await call<{ materials: EventMaterialView[] }>(`/api/events/${eventId}/materials`);
      setMaterials(data.materials);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "자료를 불러오지 못했어요");
    }
  }, [eventId]);

  useEffect(() => {
    setMaterials(initial);
    setFillId(null);
    setError(null);
  }, [eventId, initial]);

  const handleAdd = async () => {
    if (!form.url.trim() || form.submitting) return;
    setForm((f) => ({ ...f, submitting: true }));
    try {
      await call(`/api/events/${eventId}/materials`, jsonInit("POST", {
        kind: form.kind,
        url: form.url.trim(),
        ...(form.label.trim() ? { label: form.label.trim() } : {}),
        addedBy: "web"
      }));
      setForm((f) => ({ ...f, url: "", label: "", submitting: false }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "자료를 붙이지 못했어요");
      setForm((f) => ({ ...f, submitting: false }));
    }
  };

  // 공개 예정이던 자료가 올라왔을 때 링크만 넣으면 available 로 바뀐다.
  const handleFill = async (id: number) => {
    if (!fillUrl.trim()) return;
    try {
      await call(`/api/materials/${id}`, jsonInit("PATCH", { status: "available", url: fillUrl.trim() }));
      setFillId(null);
      setFillUrl("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "링크를 저장하지 못했어요");
    }
  };

  return (
    <div className="event-detail-materials" data-testid="event-materials">
      <p className="event-detail-section-label">자료</p>
      {materials.length > 0 && (
        <ul className="event-material-list" role="list">
          {materials.map((m) => (
            <li key={m.id} className="event-material" data-status={m.status}>
              <span className="event-material-kind">{KIND_LABEL[m.kind]}</span>
              <span className="event-material-body">
                {m.status === "available" && m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer noopener">{m.label ?? m.url}</a>
                ) : (
                  <span>{m.label ?? m.note ?? KIND_LABEL[m.kind]}</span>
                )}
                {statusText(m) && <span className="event-material-status">{statusText(m)}</span>}
                {m.status !== "available" && m.sourceUrl && (
                  <a className="event-material-source" href={m.sourceUrl} target="_blank" rel="noreferrer noopener">출처</a>
                )}
              </span>
              {m.status !== "available" && fillId !== m.id && (
                <button type="button" className="event-material-fill-btn" onClick={() => { setFillId(m.id); setFillUrl(""); }}>
                  링크 넣기
                </button>
              )}
              {fillId === m.id && (
                <form
                  className="event-material-fill"
                  onSubmit={(e) => { e.preventDefault(); void handleFill(m.id); }}
                  aria-label={`${KIND_LABEL[m.kind]} 링크 넣기`}
                >
                  <input
                    className="today-reply-input"
                    type="url"
                    value={fillUrl}
                    onChange={(e) => setFillUrl(e.target.value)}
                    placeholder="https://"
                    aria-label="자료 링크"
                    autoFocus
                  />
                  <button type="submit" className="today-submit-btn" disabled={!fillUrl.trim()} aria-label="링크 저장">→</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <form
        className="event-material-add"
        onSubmit={(e) => { e.preventDefault(); void handleAdd(); }}
        aria-label="자료 붙이기"
      >
        <select
          className="event-material-kind-select"
          value={form.kind}
          onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as Kind }))}
          aria-label="자료 종류"
          disabled={form.submitting}
        >
          {ADD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <input
          className="today-reply-input event-material-label-input"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          placeholder="세션명 (선택)"
          aria-label="세션명"
          disabled={form.submitting}
        />
        <input
          className="today-reply-input"
          type="url"
          value={form.url}
          onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
          placeholder="링크 붙여넣기"
          aria-label="자료 링크 입력"
          disabled={form.submitting}
        />
        <button type="submit" className="today-submit-btn" disabled={form.submitting || !form.url.trim()} aria-label="자료 붙이기 제출">
          {form.submitting ? "…" : "→"}
        </button>
      </form>
      {error && <p className="sheet-error" role="alert">{error}</p>}
    </div>
  );
}
