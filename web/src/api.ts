const ACCESS_MARKERS = ["Cloudflare-Access", "/cdn-cgi/access/login", "cloudflareaccess.com"];

export type AccessSessionError = {
  kind: "access_session_required";
  message: string;
};

export type ApiError = {
  kind: "api_error";
  status: number;
  message: string;
};

export type FetchError = AccessSessionError | ApiError;

function isAccessBody(text: string): boolean {
  return ACCESS_MARKERS.some((m) => text.includes(m));
}

function isHtmlContentType(res: Response): boolean {
  const ct = res.headers?.get?.("content-type") ?? "";
  return ct.includes("text/html") || ct.includes("text/plain");
}

// Fetches a JSON API endpoint and classifies errors.
// Throws FetchError for both Access-session and generic API failures.
// Throws on fetch() rejection (network error) with access-or-network copy.
export async function apiJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    const err: AccessSessionError = {
      kind: "access_session_required",
      message: "로그인 세션이 만료됐거나 네트워크가 끊겼어"
    };
    throw err;
  }

  // 401/403 → Access boundary
  if (res.status != null && (res.status === 401 || res.status === 403)) {
    const err: AccessSessionError = { kind: "access_session_required", message: "로그인 세션이 만료됐거나 네트워크가 끊겼어" };
    throw err;
  }

  // Redirected to CF Access login page
  if (res.redirected && ACCESS_MARKERS.some((m) => res.url?.includes(m))) {
    const err: AccessSessionError = { kind: "access_session_required", message: "로그인 세션이 만료됐거나 네트워크가 끊겼어" };
    throw err;
  }

  // Non-JSON content-type: read body to check for CF Access markers
  if (isHtmlContentType(res)) {
    const text = await res.text();
    if (isAccessBody(text)) {
      const err: AccessSessionError = { kind: "access_session_required", message: "로그인 세션이 만료됐거나 네트워크가 끊겼어" };
      throw err;
    }
    const err: ApiError = { kind: "api_error", status: res.status, message: `Unexpected HTML response (${res.status})` };
    throw err;
  }

  const data = await res.json() as T;
  return data;
}
