import {
  ChatCompletionRequestSchema,
  ChatCompletionResponseSchema,
  type ChatCompletionRequest,
  type ChatCompletionResponse
} from "@cairn/shared";

const DEFAULT_BASE_URL = "http://localhost:8000";
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";

export type LlmGatewayErrorCode =
  | "invalid_request"
  | "invalid_response"
  | "mock_not_allowed"
  | "queue_full"
  | "rate_limited"
  | "unavailable";

export type LlmGatewayError = {
  code: LlmGatewayErrorCode;
  message: string;
  status?: number;
};

export type LlmGatewayResult =
  | { ok: true; data: ChatCompletionResponse }
  | { ok: false; error: LlmGatewayError };

export type LlmGatewayOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  retryCount?: number;
  concurrency?: number;
  queueCapacity?: number;
  allowMock?: boolean;
  fetchImpl?: typeof fetch;
};

type QueueTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

class BoundedQueue {
  private active = 0;
  private readonly pending: QueueTask<unknown>[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly capacity: number
  ) {}

  get isFull(): boolean {
    return this.active + this.pending.length >= this.capacity;
  }

  enqueue<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        run: run as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject
      });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency) {
      const task = this.pending.shift();
      if (!task) return;

      this.active += 1;
      task
        .run()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

export type LlmGateway = {
  completeChat: (request: ChatCompletionRequest) => Promise<LlmGatewayResult>;
  chatCompletionsUrl: URL;
};

export function createLlmGateway(options: LlmGatewayOptions = {}): LlmGateway {
  const baseUrl = options.baseUrl ?? process.env.LLM_PROXY_BASE_URL ?? DEFAULT_BASE_URL;
  const chatCompletionsUrl = new URL(CHAT_COMPLETIONS_PATH, ensureTrailingSlash(baseUrl));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retryCount = options.retryCount ?? 1;
  const queue = new BoundedQueue(options.concurrency ?? 1, options.queueCapacity ?? 8);
  const allowMock = options.allowMock ?? process.env.NODE_ENV === "test";
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    chatCompletionsUrl,
    async completeChat(request) {
      const parsedRequest = ChatCompletionRequestSchema.safeParse(request);
      if (!parsedRequest.success) {
        return failure("invalid_request", "LLM request failed schema validation");
      }

      if (parsedRequest.data.mock === true && !allowMock) {
        return failure("mock_not_allowed", "LLM mock mode is allowed only in tests");
      }

      if (queue.isFull) {
        return failure("queue_full", "LLM gateway queue is full");
      }

      return queue.enqueue(() =>
        sendWithRetry({
          request: parsedRequest.data,
          url: chatCompletionsUrl,
          timeoutMs,
          retryCount,
          fetchImpl
        })
      );
    }
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function failure(
  code: LlmGatewayErrorCode,
  message: string,
  status?: number
): LlmGatewayResult {
  return {
    ok: false,
    error: status === undefined ? { code, message } : { code, message, status }
  };
}

async function sendWithRetry(input: {
  request: ChatCompletionRequest;
  url: URL;
  timeoutMs: number;
  retryCount: number;
  fetchImpl: typeof fetch;
}): Promise<LlmGatewayResult> {
  for (let attempt = 0; attempt <= input.retryCount; attempt += 1) {
    const result = await sendOnce(input.request, input.url, input.timeoutMs, input.fetchImpl);
    if (shouldRetry(result, attempt, input.retryCount)) continue;
    return result;
  }

  return failure("unavailable", "LLM proxy is unavailable");
}

function shouldRetry(
  result: LlmGatewayResult,
  attempt: number,
  retryCount: number
): boolean {
  if (attempt >= retryCount || result.ok) return false;
  return result.error.code === "unavailable" && (result.error.status ?? 500) >= 500;
}

async function sendOnce(
  request: ChatCompletionRequest,
  url: URL,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<LlmGatewayResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });

    if (response.status === 429) {
      return failure("rate_limited", "LLM proxy rate limited the request", response.status);
    }

    if (!response.ok) {
      return failure("unavailable", "LLM proxy returned an unavailable response", response.status);
    }

    const payload: unknown = await response.json();
    const parsedResponse = ChatCompletionResponseSchema.safeParse(payload);
    if (!parsedResponse.success) {
      return failure("invalid_response", "LLM proxy returned an invalid response");
    }

    return { ok: true, data: parsedResponse.data };
  } catch {
    return failure("unavailable", "LLM proxy is unavailable");
  } finally {
    clearTimeout(timeout);
  }
}
