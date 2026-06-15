---
name: advisor
description: Opus 위임 메타 스킬. Executor(Sonnet)가 step 시작/완료/루프 시 Step Advisor(Opus sub-agent)를 호출하는 절차와 응답 처리·외재화 규칙. clean-context 격리 원칙으로 실행.
---

# Advisor (Step Advisor 위임)

> Step Advisor는 Executor의 message history를 상속받지 않는 **clean-context sub-agent (Opus)**.
> "왜 이렇게 구현했는가"가 아니라 "spec에서 거꾸로 추론할 때 이 구현이 맞는가"로 검증한다.
> source of truth: `/AGENTS.md`, `.claude/CLAUDE.md` "Step Advisor 호출" 섹션.

## 호출 시점 (의무)

| 시점 | 형식 | 의무 |
|------|------|------|
| 새 모듈/기능 작업 시작 직전 | `Approach check: [모듈명], [핵심 판단 지점 2-3개]` | 필수 |
| 작업 단위(step) 완료 직후 | `Completion check: [변경 파일], [회귀 우려 지점 2-3개]` | 필수 |
| 같은 에러 2회 재현 시 | `Loop break: [에러 시그니처], [시도한 것 3개], [근본 원인 가설]` | 자동 강제 (track-failures.sh) |

> trivial 작업(typo, 주석 추가)에는 호출하지 않는다 — 남용 anti-pattern.

## 호출 방식

```
Agent({
  subagent_type: "general-purpose",
  model: "opus",
  description: "Advisor check",
  prompt: "<Approach/Completion/Loop break 질문 그대로>"
})
```

응답 제약: **100단어 이내, 단계 나열 (산문 금지).**

## 응답 처리 (외재화)

응답 받은 직후 `.review/cycle-N/advisor-feedback/step-NNN.md`에 저장. 형식은 `/AGENTS.md` "Advisor Feedback Externalization" 섹션 참조:

```markdown
# Step <NNN> — <implementation 요약>

Cycle: <N>
Pass: <N>
Files Changed: <list>

## Advisor Verdict
PASS | NEEDS_REVIEW

## Advisor Feedback
<Opus 응답 그대로>

## Sonnet Response
- 적용: <항목별>
- 무시: <항목> (이유: <왜 user intent/plan과 충돌하는지>)
```

## 핵심 계약

- **"무시" 결정 시 이유 명시 의무.** 이유 없는 무시 = anti-pattern. Communication bridge가 명시화되는 지점.
- 저장 누락 시 `save-advisor-feedback.sh`(Stop hook)가 block.
- Completion check 누락 시 `force-advisor-check.sh`(Stop hook)가 block.
