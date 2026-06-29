import { useEffect, useRef, useState } from "react";
import { ProviderStatusResponseSchema, type ProviderStatusRow, type ProviderStatusState } from "@cairn/shared";
import { apiJson } from "./api.js";

// Provider Status Badges A (cycle-82). A quiet, always-visible diagnostic row in
// AppNav: "are Google and Naver connected right now?". It owns its own polling
// lifecycle (so it lives in this dedicated data component, not a reusable card).
// A status-endpoint failure NEVER breaks navigation — the last known rows are
// preserved and marked stale.

const STATE_LABEL: Record<ProviderStatusState, string> = {
  connected: "연결됨",
  disabled: "비활성",
  degraded: "연결 안 됨"
};

// ttlSeconds is always >= 300 (server default), so a 5-minute floor is both safe
// and simple — it never polls upstream faster than the server cache refreshes.
const POLL_INTERVAL_MS = 300_000;

type Loaded = { rows: ProviderStatusRow[]; stale: boolean };

async function fetchProviderStatus(): Promise<ProviderStatusRow[]> {
  const body = await apiJson<unknown>("/api/providers/status");
  const parsed = ProviderStatusResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("invalid provider status payload");
  return parsed.data.data.providers;
}

export function ProviderStatusBadges() {
  const [state, setState] = useState<Loaded | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (inFlight.current) return; // single in-flight guard — ignore overlap
      inFlight.current = true;
      try {
        const rows = await fetchProviderStatus();
        if (mounted) setState({ rows, stale: false });
      } catch {
        // Preserve last known rows + mark stale; quiet until the first success.
        if (mounted) setState((prev) => (prev ? { rows: prev.rows, stale: true } : null));
      } finally {
        inFlight.current = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  if (!state || state.rows.length === 0) return null; // quiet state — no badges yet

  return (
    <ul className="provider-status" role="list" aria-label="프로바이더 연결 상태" data-testid="provider-status">
      {state.rows.map((p) => (
        <li
          key={p.id}
          className={`provider-status-badge provider-status-badge--${p.state}${state.stale ? " provider-status-badge--stale" : ""}`}
          data-testid={`provider-status-${p.id}`}
          data-state={p.state}
          aria-label={`${p.label} ${STATE_LABEL[p.state]}${state.stale ? " (확인 중)" : ""}`}
          title={p.message}
        >
          <span className="provider-status-dot" aria-hidden="true" />
          <span className="provider-status-label">
            {p.label} {STATE_LABEL[p.state]}{state.stale ? " (확인 중)" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
