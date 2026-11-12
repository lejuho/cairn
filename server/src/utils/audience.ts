import type { FastifyRequest } from "fastify";

// 원격 MCP 커넥터(ChatGPT 등)를 대신한 요청인가.
// 원격 MCP 서버(mcp/src/remote.ts)가 Cairn API 를 부를 때 이 헤더를 붙인다. 외부 클라이언트는
// API 가 아니라 MCP 서버하고만 말하므로, 헤더를 빼고 들어올 길이 없다.
//
// 규칙: 사용자가 쓴 개인 기록(메모 등)은 기본 비공개다. 원격 요청에는 사용자가 공개로 표시한
// 것만 내보낸다. 새 종류의 개인 기록을 추가할 때도 같은 규칙을 따른다 (docs/codebase-map.md).
export const AUDIENCE_HEADER = "x-cairn-audience";

export function isRemoteAudience(req: FastifyRequest): boolean {
  return req.headers[AUDIENCE_HEADER] === "remote";
}
