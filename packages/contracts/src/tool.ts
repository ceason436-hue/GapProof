import { type Static, type TSchema, Type } from "@sinclair/typebox";

export const ToolStatusSchema = Type.Union([
  Type.Literal("succeeded"),
  Type.Literal("needs_confirmation"),
  Type.Literal("retryable_error"),
  Type.Literal("failed"),
]);

export const ToolErrorSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
  retryable: Type.Boolean(),
  providerCode: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export function toolResultSchema<T extends TSchema>(dataSchema: T) {
  return Type.Object({
    status: ToolStatusSchema,
    data: Type.Optional(dataSchema),
    confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    evidenceRefs: Type.Array(Type.String()),
    citations: Type.Array(Type.String()),
    warnings: Type.Array(Type.String()),
    toolVersion: Type.String({ minLength: 1 }),
    latencyMs: Type.Integer({ minimum: 0 }),
    error: Type.Optional(ToolErrorSchema),
  });
}

export interface ToolRequest<T> {
  readonly toolCallId: string;
  readonly caseId: string;
  readonly studentId: string;
  readonly traceId: string;
  readonly input: T;
  readonly policyVersion: string;
}

export interface ToolError extends Static<typeof ToolErrorSchema> {}

export interface ToolResult<T> {
  readonly status: Static<typeof ToolStatusSchema>;
  readonly data?: T;
  readonly confidence?: number;
  readonly evidenceRefs: readonly string[];
  readonly citations: readonly string[];
  readonly warnings: readonly string[];
  readonly toolVersion: string;
  readonly latencyMs: number;
  readonly error?: ToolError;
}

