---
name: backend-next
description: Backend(Next.js API Route + Supabase + Zod) 규범. 입력은 Zod 파싱 후 사용, userId는 세션에서만, 표준 응답 포맷, 상태 전환은 중앙 함수 통과. API route/service 작업 시 로드.
---

# 백엔드 (Next.js API Route + Supabase + Zod)

## 절대 쓰지 말 것

```
- req.body 직접 DB에 넣기 (반드시 스키마 파싱 후)
- SELECT * (필요한 컬럼만 명시)
- userId를 body에서 받기 (반드시 세션에서 추출)
- 에러를 그냥 throw (반드시 표준 에러 포맷 함수로)
- 하드코딩된 workspace_id, user_id
- any 타입
```

## Zod 입력 검증 — 모든 API Route에서 파싱 후 사용

```tsx
// schemas/<entity>.ts
import { z } from 'zod';

export const Create<Entity>Schema = z.object({
  <parentEntityId>: z.string().uuid(),
  title: z.string().min(1).max(100),
});
```

```tsx
// app/api/<entity>/route.ts
const body = Create<Entity>Schema.parse(await req.json()); // 실패 시 ZodError → 400
```

## userId는 세션에서만

```tsx
const { data: { session } } = await supabase.auth.getSession();
const userId = session?.user.id;     // 서버가 검증한 값
if (!userId) return forbidden();
// req.body.userId 사용 금지 (클라이언트 조작 가능)
```

## 표준 응답 포맷 (`utils/response.ts`)

`ok` / `created` / `badRequest` / `forbidden` / `notFound` / `serverError` 만 사용.
형식: `{ ok: true, data }` 또는 `{ ok: false, error }`. 직접 `Response.json` 작성 금지.

## 상태 전환 — 중앙 함수 통과 필수

```tsx
// utils/<entity>Status.ts
const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:     ['in_review'],
  in_review: ['approved', 'rejected', 'draft'],
  approved:  [],
  rejected:  ['draft'],
};
export function assertValidTransition(from: string, to: string) {
  if (!VALID_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`invalid transition: ${from} → ${to}`);
  }
}
```

status 바꾸는 코드 어디서든 반드시 이 함수 먼저 호출.

## API Route 기본 구조

```tsx
export async function POST(req: Request) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return forbidden();              // 1. 인증
    const body = Create<Entity>Schema.parse(await req.json()); // 2. 입력 검증
    const result = await create<Entity>({ ...body, createdBy: session.user.id }); // 3. 로직
    return created(result);                        // 4. 표준 응답
  } catch (e) {
    if (e instanceof ZodError) return badRequest(e.message);
    return serverError();
  }
}
```

- RLS는 코드에서 권한 체크를 빠뜨려도 DB 레벨에서 막아주는 마지막 방어선.
- 타입 파일에 없는 타입을 새로 만들지 말고 개발자에게 먼저 물어볼 것.
