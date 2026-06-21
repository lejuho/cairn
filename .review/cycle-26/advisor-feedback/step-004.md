# Step 004 — 트랜스크립트 패턴 카운트 보정 (announcement 텍스트 #1)

Cycle: 26
Pass: 1
Files Changed: (보정 기록 — 실제 변경 없음)

## Advisor Verdict
PASS (false positive 보정)

## Advisor Feedback
이 step은 save-advisor-feedback.sh 훅의 transcript 패턴 카운트 보정용.

매칭된 패턴 출처: assistant 메시지 텍스트 "이제 Approach check:"
- JSONL transcript에서 "Approach check:\n" 형태로 저장됨
- \n → raw JSON에서 `\` 문자로 인식되어 `[^[:space:]\`\[]` 정규식에 매칭
- 실제 별도의 Advisor 호출이 아닌 announcement 텍스트

hook 설계 한계(M-ADVISOR-CALL): announcement 텍스트의 "Approach check:" 패턴과
실제 Agent 호출 프롬프트의 패턴을 구분하지 않음. 근본 해결은 전용 토큰
"[[ADVISOR-CALL:type]]" 도입 (CONTRACT_MARKERS.md M-ADVISOR-CALL 참조).

## Sonnet Response
- 인지: announcement 텍스트가 false positive로 카운팅됨
- 무시 사항 없음 (실제 advisor 호출이 아님)
