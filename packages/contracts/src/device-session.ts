import { type Static, Type } from "@sinclair/typebox";

export const MAX_REAL_OCR_BATCH_PAGES = 50;

export const DeviceSessionViewSchema = Type.Object({
  authenticated: Type.Literal(true),
  studentId: Type.String({ format: "uuid" }),
  expiresAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const DeviceSessionClosedViewSchema = Type.Object({
  authenticated: Type.Literal(false),
}, { additionalProperties: false });

export const RecoverableOcrBatchViewSchema = Type.Object({
  batchId: Type.String({ format: "uuid" }),
  caseId: Type.String({ format: "uuid" }),
  status: Type.Union([
    Type.Literal("collecting"), Type.Literal("ready"), Type.Literal("processing"),
    Type.Literal("needs_confirmation"), Type.Literal("retryable_error"), Type.Literal("failed"),
  ]),
  pageCount: Type.Integer({ minimum: 0 }),
  resumeKind: Type.Union([
    Type.Literal("continue_upload"), Type.Literal("wait"),
    Type.Literal("review"), Type.Literal("retry"),
  ]),
  updatedAt: Type.String({ format: "date-time" }),
}, { additionalProperties: false });

export const RecoverableOcrBatchesViewSchema = Type.Object({
  batches: Type.Array(RecoverableOcrBatchViewSchema),
}, { additionalProperties: false });

export type DeviceSessionView = Static<typeof DeviceSessionViewSchema>;
export type RecoverableOcrBatchView = Static<typeof RecoverableOcrBatchViewSchema>;
