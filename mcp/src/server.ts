import { readApiConfig, type CairnApiClientConfig } from "./api.js";
import { isJsonObject, toJsonValue, type JsonObject, type JsonValue } from "./json.js";
import { callTool, TOOLS } from "./tools.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonValue;
}

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: JsonValue;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
  };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

const SERVER_INFO = {
  name: "cairn-mcp",
  version: "0.1.0"
};

export class CairnMcpServer {
  private readonly apiConfig: CairnApiClientConfig;

  constructor(apiConfig: CairnApiClientConfig = readApiConfig()) {
    this.apiConfig = apiConfig;
  }

  async handleLine(line: string): Promise<JsonRpcResponse | null> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return error(null, -32700, "Parse error");
    }

    const request = parseRequest(parsed);
    if (!request.ok) return error(request.id, -32600, request.message);

    if (request.message.id === undefined) {
      await this.handleNotification(request.message);
      return null;
    }

    try {
      const result = await this.handleRequest(request.message);
      return { jsonrpc: "2.0", id: request.message.id, result };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Internal error";
      return error(request.message.id, -32603, message);
    }
  }

  private async handleNotification(request: JsonRpcRequest): Promise<void> {
    if (request.method === "notifications/initialized" || request.method === "notifications/cancelled") return;
    return;
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonValue> {
    switch (request.method) {
      case "initialize":
        return this.initializeResult(request.params);
      case "ping":
        return {};
      case "tools/list":
        return { tools: TOOLS.map((tool) => toJsonValue(tool)) };
      case "tools/call":
        return toJsonValue(await this.handleToolCall(request.params));
      case "resources/list":
        return { resources: [] };
      case "prompts/list":
        return { prompts: [] };
      default:
        throw new JsonRpcMethodError(`Method not found: ${request.method}`);
    }
  }

  private initializeResult(params: JsonValue | undefined): JsonObject {
    const protocolVersion =
      isJsonObject(params) && typeof params.protocolVersion === "string"
        ? params.protocolVersion
        : "2024-11-05";
    return {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false },
        resources: {},
        prompts: {}
      },
      serverInfo: SERVER_INFO,
      instructions:
        "Cairn is the user's context/priority hub. At the start of a conversation about plans or work, call cairn_context_now (or cairn_inbox) once; ask at most 1-2 pending questions when it does not interrupt the user's task, and record only real answers with cairn_confirm. Record decisions/appointments that come up in conversation with cairn_observe. Prefer specific tools; use cairn_api_request for routes not wrapped explicitly."
    };
  }

  private async handleToolCall(params: JsonValue | undefined): Promise<JsonValue> {
    if (!isJsonObject(params)) throw new Error("tools/call params must be an object");
    const name = params.name;
    if (typeof name !== "string" || name.trim().length === 0) throw new Error("tool name is required");
    const rawArgs = params.arguments;
    if (rawArgs !== undefined && !isJsonObject(rawArgs)) throw new Error("tool arguments must be an object");
    return toJsonValue(await callTool(this.apiConfig, name, rawArgs));
  }
}

export async function runStdioServer(server = new CairnMcpServer()): Promise<void> {
  process.stdin.setEncoding("utf8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      void emitResponse(server, line);
      newlineIndex = buffer.indexOf("\n");
    }
  });

  process.stdin.on("end", () => {
    const tail = buffer.trim();
    if (tail.length > 0) void emitResponse(server, tail);
  });
}

async function emitResponse(server: CairnMcpServer, line: string): Promise<void> {
  const response = await server.handleLine(line);
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}

function parseRequest(value: unknown): { ok: true; message: JsonRpcRequest } | { ok: false; id: JsonRpcId; message: string } {
  if (!isJsonObject(value)) return { ok: false, id: null, message: "Invalid Request" };
  const id = parseId(value.id);
  if (value.id !== undefined && id === undefined) return { ok: false, id: null, message: "Invalid id" };
  if (value.jsonrpc !== "2.0") return { ok: false, id: id ?? null, message: "jsonrpc must be 2.0" };
  if (typeof value.method !== "string" || value.method.length === 0) {
    return { ok: false, id: id ?? null, message: "method must be a string" };
  }
  const message: JsonRpcRequest = {
    jsonrpc: "2.0",
    method: value.method,
    ...(id !== undefined ? { id } : {}),
    ...(value.params !== undefined ? { params: value.params } : {})
  };
  return { ok: true, message };
}

function parseId(value: JsonValue | undefined): JsonRpcId | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string") return value;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  return undefined;
}

function error(id: JsonRpcId, code: number, message: string): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

class JsonRpcMethodError extends Error {}
