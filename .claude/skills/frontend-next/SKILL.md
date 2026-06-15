---
name: frontend-next
description: Frontend(React/Next.js) 컴포넌트 작업 규범. 컴포넌트=props in/callback out, 데이터 직접 fetch 금지, 로딩/에러 슬롯 필수. component/page 작업 시 로드.
---

# 프론트엔드 (React/Next.js)

## 5개 핵심 규칙

```
1. 컴포넌트 하나당 파일 하나
2. 데이터를 직접 fetch하지 말 것 — props로만 받기
3. 버튼 onClick은 반드시 props로 받기 (내부에서 API 호출 금지)
4. useState는 최대한 위로 올리기 (페이지 레벨에서 관리)
5. 파일명 = 컴포넌트명 (BundleCard.tsx, ReviewPanel.tsx)
```

## 절대 쓰지 말 것

```
- any 타입
- useEffect 안에서 fetch
- 컴포넌트 안에서 router.push 직접 호출
- console.log (디버깅 후 반드시 제거)
- 인라인 스타일 (style={{ }}) — Tailwind 클래스만
- 파일 안에 타입 직접 선언 (types/index.ts에서 import)
```

## 올바른 컴포넌트 패턴 — 데이터는 props, 액션은 콜백

```tsx
// <Entity>Card.tsx
import { <Entity> } from '@/types';

type Props = {
  name: string;
  status: <Entity>['status'];
  isLoading: boolean;
  error: string | null;
  onClick: () => void;       // 내부에서 뭘 할지 모름, 위에서 결정
};

export function <Entity>Card({ name, status, isLoading, error, onClick }: Props) {
  if (isLoading) return <div>로딩 중...</div>;
  if (error) return <div>{error}</div>;
  return (
    <div onClick={onClick}>
      <span>{name}</span>
      <Badge status={status} />
    </div>
  );
}
```

API 연결은 **페이지 레벨에서만** (`app/.../page.tsx`). 컴포넌트 안에서 `fetch`/`router.push` 금지.

## 이벤트 핸들러 네이밍 — `on + 명사 + 동사`

```
on<Entity>Click / on<Action>Approve / on<Action>RequestChanges / onCommentResolve
```

## 로딩/에러 슬롯 — 모든 컴포넌트 props에 필수

```tsx
type Props = { isLoading: boolean; error: string | null; /* ... */ };
if (isLoading) return <div>로딩 중...</div>;
if (error) return <div>{error}</div>;
```

## 목업 데이터 — 파일 하나로 통일 (`mocks/index.ts`)

컴포넌트 안에 하드코딩 금지. 무조건 `mocks/index.ts`에서 import. 타입도 `@/types`에서 import.

## 컴포넌트 완성 기준

```
□ props 타입 정의됨 (types/index.ts에서 import)
□ 로딩/에러 상태 처리됨
□ 목업 데이터로 렌더링 확인됨
□ 위 "절대 쓰지 말 것" 위반 없음
```
