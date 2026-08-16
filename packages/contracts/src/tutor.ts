import { type Static, Type } from "@sinclair/typebox";

export const TUTOR_POLICY_VERSION = "socratic-tutor-v1";
export const TUTOR_MAX_TURNS_PER_TASK = 6;
export const TUTOR_MAX_TURNS_PER_DAY = 12;

export const TutorNextActionSchema = Type.Union([
  Type.Literal("reflect"),
  Type.Literal("retry_step"),
  Type.Literal("ask_for_help"),
]);

export const TutorTurnStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("fallback"),
  Type.Literal("failed"),
]);

export const CreateTutorTurnRequestSchema = Type.Object({
  expectedVersion: Type.Integer({ minimum: 0 }),
  stepId: Type.String({ minLength: 1, maxLength: 128 }),
  learnerText: Type.String({ minLength: 1, maxLength: 800 }),
}, { additionalProperties: false });

export const SocraticTutorContextSchema = Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 40 }),
  grade: Type.String({ minLength: 1, maxLength: 40 }),
  taskTitle: Type.String({ minLength: 1, maxLength: 160 }),
  stepTitle: Type.String({ minLength: 1, maxLength: 120 }),
  stepContent: Type.String({ minLength: 1, maxLength: 1_000 }),
  learnerText: Type.String({ minLength: 1, maxLength: 800 }),
}, { additionalProperties: false });

export const SocraticTutorOutputSchema = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 240 }),
  hint: Type.Union([Type.String({ minLength: 1, maxLength: 240 }), Type.Null()]),
  nextAction: TutorNextActionSchema,
}, { additionalProperties: false });

export const TutorTurnViewSchema = Type.Object({
  turnId: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$" }),
  taskId: Type.String({ format: "uuid" }),
  status: TutorTurnStatusSchema,
  response: Type.Union([SocraticTutorOutputSchema, Type.Null()]),
  retryable: Type.Boolean(),
}, { additionalProperties: false });

export const TutorTurnJobDataSchema = Type.Object({
  turnId: Type.String({ format: "uuid" }),
  traceId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });

export type SocraticTutorContext = Static<typeof SocraticTutorContextSchema>;
export type SocraticTutorOutput = Static<typeof SocraticTutorOutputSchema>;
export type TutorNextAction = Static<typeof TutorNextActionSchema>;
export type CreateTutorTurnRequest = Static<typeof CreateTutorTurnRequestSchema>;
export type TutorTurnView = Static<typeof TutorTurnViewSchema>;
export type TutorTurnJobData = Static<typeof TutorTurnJobDataSchema>;

export function isUuidV7(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isTutorTurnJobData(value: unknown): value is TutorTurnJobData {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isUuidV7(candidate.turnId) &&
    typeof candidate.traceId === "string" && candidate.traceId.length > 0 && candidate.traceId.length <= 128;
}
