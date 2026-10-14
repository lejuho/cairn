import { z } from "zod";

// 이벤트 자료: 일정이 남긴 결과물(슬라이드·다시보기·녹음·메모)에 대한 포인터.
// resources(준비물 = 들어가는 것)와 달리 나오는 것이며, "공개 예정 → 공개됨" 수명주기를 가진다.
// 본문은 저장하지 않고 URL·출처만 남긴다.

export const MATERIAL_KINDS = ["slides", "video", "recording", "notes", "photo", "link", "file"] as const;
export const MaterialKindSchema = z.enum(MATERIAL_KINDS);

export const MATERIAL_STATUSES = ["expected", "available", "missing"] as const;
export const MaterialStatusSchema = z.enum(MATERIAL_STATUSES);

const url = z.string().url().max(2000);

export const CreateEventMaterialRequestSchema = z
  .object({
    kind: MaterialKindSchema,
    status: MaterialStatusSchema.default("available"),
    // 하루짜리 행사 안의 세션명 등. 하위 이벤트로 쪼개지 않고 라벨로만 구분.
    label: z.string().trim().min(1).max(200).optional(),
    url: url.optional(),
    // expected 일 때 다시 확인할 시점. 지나면 inbox 에 material_due 질문이 생긴다.
    expectedAt: z.string().datetime({ offset: true }).optional(),
    // 공개 예정 정보를 확인한 공식 출처.
    sourceUrl: url.optional(),
    note: z.string().max(500).optional(),
    addedBy: z.string().max(100).optional()
  })
  .strict()
  .refine((v) => v.status !== "available" || v.url !== undefined || v.note !== undefined, {
    message: "available material needs url or note"
  })
  .refine((v) => v.status !== "expected" || v.expectedAt !== undefined, {
    message: "expected material needs expectedAt"
  });
export type CreateEventMaterialRequest = z.infer<typeof CreateEventMaterialRequestSchema>;

export const PatchEventMaterialRequestSchema = z
  .object({
    status: MaterialStatusSchema.optional(),
    label: z.string().trim().min(1).max(200).nullable().optional(),
    url: url.nullable().optional(),
    expectedAt: z.string().datetime({ offset: true }).nullable().optional(),
    sourceUrl: url.nullable().optional(),
    note: z.string().max(500).nullable().optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field required" });
export type PatchEventMaterialRequest = z.infer<typeof PatchEventMaterialRequestSchema>;

export type EventMaterialView = {
  id: number;
  eventId: number;
  kind: z.infer<typeof MaterialKindSchema>;
  status: z.infer<typeof MaterialStatusSchema>;
  label: string | null;
  url: string | null;
  expectedAt: string | null;
  sourceUrl: string | null;
  note: string | null;
  addedBy: string | null;
  // missing 일 때만: confirmed = 공개 안 함을 확인, auto_expired = 유예 내 확인 못 해 자동 정리.
  missingReason: "confirmed" | "auto_expired" | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export const CAPTURE_PROFILES = ["talk", "class", "meeting", "hackathon"] as const;
export type CaptureProfile = (typeof CAPTURE_PROFILES)[number];

export type CaptureCheckItem = {
  kind: z.infer<typeof MaterialKindSchema>;
  question: string;
  // 이미 기록된 자료가 있으면 해당 상태. null = 아직 확인 안 함.
  covered: z.infer<typeof MaterialStatusSchema> | null;
};

export type CaptureCheck = {
  eventId: number;
  profile: CaptureProfile | null;
  items: CaptureCheckItem[];
  instruction: string;
  materials: EventMaterialView[];
};
