# Step 001 — Approach check: Sequence Energy A (cycle-42)

Cycle: 42
Pass: 1
Files Changed: (pre-implementation)

## Advisor Verdict
PASS

## Advisor Feedback
1. Helper location: context-switch.ts. Colocating TRANSITION_LOAD_UNITS with the cost classifier keeps transition semantics in one module; feasibility.ts stays orchestration-only. Higher cohesion.
2. No rounding needed for correctness — 0.25/0.75 are exact dyadic fractions (k/4), sums stay exact in binary fp. BUT round defensively (to 4 decimals) on the final aggregate only, to immunize UI/test equality against future coefficient change. Cheap insurance.
3. reasonCodes: all four proposed. Stable, orthogonal, snake_case. Emit deterministically in fixed order. sequence_work_only and sequence_transition_added are mutually exclusive (one or the other, never both).
4. remainingUnits = budget − total, negative allowed. Match existing energy.remainingUnits convention. deficit = total > budget.

Note: confirm budget source — sequenceEnergy reuses energy.budgetUnits (= p.energyBudget) to avoid divergence.

## Sonnet Response
- 적용: 1 — computeSequenceEnergy를 context-switch.ts에 배치
- 적용: 2 — 집계값만 4-decimal 방어 반올림
- 적용: 3 — reason 4종 고정 순서, work_only/transition_added 상호배타
- 적용: 4 — remaining=budget−total(음수 허용), deficit=total>budget, budget=p.energyBudget (energy와 동일)
