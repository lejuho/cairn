import type {
  CreateReversePlanWatcherRequest,
  ReversePlanData,
  ReversePlanView
} from "@cairn/shared";

const YYYYMMDD = /^\d{4}-\d{2}-\d{2}$/;

// Validate a YYYY-MM-DD string and verify it's a real calendar date (no overflow).
function validateDate(d: string): boolean {
  if (!YYYYMMDD.test(d)) return false;
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).toISOString().slice(0, 10) === d;
}

function subtractDays(dateStr: string, days: number): string {
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  return new Date(ms - days * 86_400_000).toISOString().slice(0, 10);
}

export type ComputedStep = {
  label: string;
  leadDays: number;
  latestDate: string;
};

export type ComputeReversePlanResult =
  | { ok: true; computedSteps: ComputedStep[]; firstThreshold: string }
  | { ok: false; error: string };

// Pure computation: validate input dates and compute latestDate for each step.
// Steps are in execution order (index 0 = first to execute).
// Walk: cursor = targetDate; iterate from last step to first.
//   latestDate = cursor - leadDays [ - safetyDays if index === 0 ]
//   cursor = latestDate
export function computeReversePlan(
  input: CreateReversePlanWatcherRequest
): ComputeReversePlanResult {
  if (!validateDate(input.targetDate)) {
    return { ok: false, error: `targetDate '${input.targetDate}' is not a valid calendar date` };
  }

  const computedSteps: ComputedStep[] = new Array(input.steps.length) as ComputedStep[];
  let cursor = input.targetDate;

  for (let i = input.steps.length - 1; i >= 0; i--) {
    const step = input.steps[i]!;
    const deduct = step.leadDays + (i === 0 ? input.safetyDays : 0);
    const latestDate = subtractDays(cursor, deduct);

    if (!validateDate(latestDate)) {
      return { ok: false, error: `Computed date for step '${step.label}' is invalid (overflow or underflow)` };
    }

    computedSteps[i] = { label: step.label, leadDays: step.leadDays, latestDate };
    cursor = latestDate;
  }

  return { ok: true, computedSteps, firstThreshold: computedSteps[0]!.latestDate };
}

// Build the ReversePlanView from a stored rule + task statuses map.
// Returns null when the rule is malformed or task IDs are missing.
export function buildReversePlanView(
  rule: ReversePlanData,
  taskStatuses: Map<number, string>
): ReversePlanView | null {
  const stepsWithStatus = rule.steps.map((s) => {
    const taskStatus = taskStatuses.get(s.taskId);
    // Missing task → degrade safely (caller treats watcher as unsupported)
    if (taskStatus === undefined) return null;
    return { ...s, taskStatus };
  });

  if (stepsWithStatus.some((s) => s === null)) return null;

  const steps = stepsWithStatus as NonNullable<typeof stepsWithStatus[0]>[];

  const nextStepIndex = steps.findIndex((s) => s.taskStatus !== "done" && s.taskStatus !== "dropped");
  const completed = nextStepIndex === -1;

  return {
    targetDate: rule.targetDate,
    targetLabel: rule.targetLabel,
    safetyDays: rule.safetyDays,
    steps,
    nextStepIndex: completed ? null : nextStepIndex,
    completed
  };
}

// Parse and validate a stored reverse-plan rule from JSON.
// Returns null for any malformed input (fail-open → unsupported status).
export function parseReversePlanRule(raw: string | null): ReversePlanData | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { type?: unknown }).type !== "reverse_plan"
    ) return null;

    // Minimal structural check before accepting
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.targetDate !== "string" ||
      typeof p.targetLabel !== "string" ||
      typeof p.safetyDays !== "number" ||
      !Array.isArray(p.steps) ||
      typeof p.targetTaskId !== "number"
    ) return null;

    const steps = p.steps as unknown[];
    const parsedSteps = steps.map((s) => {
      if (typeof s !== "object" || s === null) return null;
      const step = s as Record<string, unknown>;
      if (
        typeof step.label !== "string" ||
        typeof step.leadDays !== "number" ||
        typeof step.latestDate !== "string" ||
        typeof step.taskId !== "number"
      ) return null;
      return {
        label: step.label,
        leadDays: step.leadDays as number,
        latestDate: step.latestDate as string,
        taskId: step.taskId as number
      };
    });

    if (parsedSteps.some((s) => s === null)) return null;

    return {
      type: "reverse_plan",
      targetDate: p.targetDate as string,
      targetLabel: p.targetLabel as string,
      safetyDays: p.safetyDays as number,
      steps: parsedSteps as ReversePlanData["steps"],
      targetTaskId: p.targetTaskId as number
    };
  } catch {
    return null;
  }
}

// Returns the effective threshold for a reverse-plan watcher:
// the latestDate of the next incomplete step, or null if completed/malformed.
export function effectiveReversePlanThreshold(view: ReversePlanView): string | null {
  if (view.completed) return null;
  const nextStep = view.steps[view.nextStepIndex!];
  return nextStep?.latestDate ?? null;
}
