import { useRef, useState } from "react";
import { NOTE_FILE_MAX_BYTES, type NoteAttachment, type NoteView } from "@cairn/shared";
import { apiJson } from "./api.js";

// Files and links on a note. Files up to 50MB are uploaded and kept on the server's disk;
// anything bigger is attached as a link (Google Drive and the like).

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { message: string } };

export type PendingAttachment = { key: number; file?: File; url?: string };

const TOO_BIG = "50MB를 넘는 파일입니다. 구글 드라이브 등에 올린 뒤 링크로 붙이세요.";
let pendingKey = 0;

export function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}MB`;
}

function isImage(mime: string | null): boolean {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/gif" || mime === "image/webp";
}

function validUrl(text: string): boolean {
  return /^https?:\/\/\S+\.\S+/i.test(text.trim());
}

async function unwrap(res: ApiResponse<{ note: NoteView }> | null, fallback: string): Promise<NoteView> {
  if (!res || res.ok !== true) throw new Error((res && !res.ok && res.error?.message) || fallback);
  return res.data.note;
}

export async function uploadFile(noteId: number, file: File): Promise<NoteView> {
  if (file.size > NOTE_FILE_MAX_BYTES) throw new Error(TOO_BIG);
  const res = await apiJson<ApiResponse<{ note: NoteView }>>(`/api/notes/${noteId}/files`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name), "x-file-type": encodeURIComponent(file.type || "application/octet-stream") },
    body: file
  });
  return unwrap(res, `${file.name} 을 올리지 못했습니다`);
}

export async function addLink(noteId: number, url: string): Promise<NoteView> {
  const res = await apiJson<ApiResponse<{ note: NoteView }>>(`/api/notes/${noteId}/links`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: url.trim() })
  });
  return unwrap(res, "링크를 붙이지 못했습니다");
}

// Sends everything picked before the note existed. Returns the note as it is afterwards.
export async function sendPending(note: NoteView, pending: PendingAttachment[]): Promise<NoteView> {
  let latest = note;
  for (const item of pending) {
    if (item.file) latest = await uploadFile(note.id, item.file);
    else if (item.url) latest = await addLink(note.id, item.url);
  }
  return latest;
}

export function AttachmentList({ attachments, onRemove, busy }: { attachments: NoteAttachment[]; onRemove?: (a: NoteAttachment) => void; busy?: boolean }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="attachment-list" role="list" aria-label="첨부">
      {attachments.map((a) => (
        <li key={a.id} className="attachment" data-kind={a.kind}>
          <a className="attachment-open" href={a.url} target="_blank" rel="noreferrer" aria-label={`${a.name} ${a.kind === "link" ? "링크 열기" : "열기"}`}>
            {a.kind === "file" && isImage(a.mime)
              ? <img className="attachment-thumb" src={a.url} alt="" loading="lazy" />
              : <span className="attachment-icon" aria-hidden="true">{a.kind === "link" ? "↗" : (a.name.split(".").pop() ?? "").slice(0, 4).toUpperCase() || "FILE"}</span>}
            <span className="attachment-name">{a.name}</span>
            {a.kind === "file" && <span className="attachment-size">{formatSize(a.size)}</span>}
          </a>
          {onRemove && <button type="button" className="note-text-btn" disabled={busy} onClick={() => onRemove(a)} aria-label={`${a.name} 첨부 빼기`}>빼기</button>}
        </li>
      ))}
    </ul>
  );
}

type AddProps = { onFiles: (files: File[]) => void; onLink: (url: string) => void; busy?: boolean; error?: string | null; onError: (message: string | null) => void };

// "+ 파일" and "+ 링크". Files over the limit are turned away here with the way around it.
function AddControls({ onFiles, onLink, busy, error, onError }: AddProps) {
  const input = useRef<HTMLInputElement>(null);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");

  const pick = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    const fits = picked.filter((f) => f.size <= NOTE_FILE_MAX_BYTES);
    if (fits.length < picked.length) {
      onError(TOO_BIG);
      setLinking(true);
    } else {
      onError(null);
    }
    if (fits.length > 0) onFiles(fits);
    if (input.current) input.current.value = "";
  };

  const submitLink = () => {
    if (!validUrl(url)) {
      onError("http 또는 https 로 시작하는 주소를 넣으세요.");
      return;
    }
    onError(null);
    onLink(url.trim());
    setUrl("");
    setLinking(false);
  };

  return (
    <div className="attachment-add">
      <div className="attachment-add-row">
        <input ref={input} type="file" multiple hidden onChange={(e) => pick(e.target.files)} aria-label="붙일 파일 고르기" data-testid="attachment-file-input" />
        <button type="button" className="note-btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? "올리는 중…" : "+ 파일"}</button>
        <button type="button" className="note-btn" disabled={busy} aria-expanded={linking} onClick={() => setLinking((v) => !v)}>+ 링크</button>
        <span className="note-hint">파일은 50MB까지</span>
      </div>
      {linking && (
        <div className="attachment-add-row">
          <input
            className="note-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitLink();
              }
            }}
            placeholder="구글 드라이브 등 주소"
            aria-label="붙일 링크 주소"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className="note-btn" disabled={busy || !url.trim()} onClick={submitLink}>붙이기</button>
        </div>
      )}
      {error && <p className="sheet-error" role="alert">{error}</p>}
    </div>
  );
}

// For a note that is already saved: changes apply at once.
export function NoteAttachments({ note, onChanged, adding = true }: { note: NoteView; onChanged: (note: NoteView) => void; adding?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<NoteView>) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : "첨부를 바꾸지 못했습니다");
    } finally {
      setBusy(false);
    }
  };

  const remove = (a: NoteAttachment) => run(async () => unwrap(
    await apiJson<ApiResponse<{ note: NoteView }>>(`/api/notes/${note.id}/attachments/${a.id}`, { method: "DELETE" }),
    "첨부를 빼지 못했습니다"
  ));

  return (
    <div className="attachments">
      <AttachmentList attachments={note.attachments ?? []} {...(adding ? { onRemove: (a: NoteAttachment) => void remove(a) } : {})} busy={busy} />
      {adding && (
        <AddControls
          busy={busy}
          error={error}
          onError={setError}
          onFiles={(files) => void run(async () => {
            let latest = note;
            for (const file of files) latest = await uploadFile(note.id, file);
            return latest;
          })}
          onLink={(url) => void run(() => addLink(note.id, url))}
        />
      )}
    </div>
  );
}

// For a note that is still being written: what is picked waits until the note is saved.
export function PendingAttachments({ pending, onChange, disabled }: { pending: PendingAttachment[]; onChange: (next: PendingAttachment[]) => void; disabled?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="attachments">
      {pending.length > 0 && (
        <ul className="attachment-list" role="list" aria-label="붙일 것">
          {pending.map((p) => (
            <li key={p.key} className="attachment" data-kind={p.file ? "file" : "link"}>
              <span className="attachment-open">
                <span className="attachment-icon" aria-hidden="true">{p.file ? (p.file.name.split(".").pop() ?? "").slice(0, 4).toUpperCase() || "FILE" : "↗"}</span>
                <span className="attachment-name">{p.file ? p.file.name : p.url}</span>
                {p.file && <span className="attachment-size">{formatSize(p.file.size)}</span>}
              </span>
              <button type="button" className="note-text-btn" disabled={disabled} onClick={() => onChange(pending.filter((x) => x.key !== p.key))} aria-label={`${p.file ? p.file.name : p.url} 빼기`}>빼기</button>
            </li>
          ))}
        </ul>
      )}
      <AddControls
        busy={disabled ?? false}
        error={error}
        onError={setError}
        onFiles={(files) => onChange([...pending, ...files.map((file) => ({ key: ++pendingKey, file }))])}
        onLink={(url) => onChange([...pending, { key: ++pendingKey, url }])}
      />
    </div>
  );
}
