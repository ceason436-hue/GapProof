import { type Static, Type } from "@sinclair/typebox";

import { toolResultSchema } from "./tool.ts";

export const ParsePaperInputSchema = Type.Object({
  assetId: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  pageHints: Type.Array(Type.String()),
});

export type ParsePaperInput = Static<typeof ParsePaperInputSchema>;

const CoordinatesSchema = Type.Object({
  page: Type.Integer({ minimum: 1 }),
  x: Type.Number({ minimum: 0 }),
  y: Type.Number({ minimum: 0 }),
  width: Type.Number({ exclusiveMinimum: 0 }),
  height: Type.Number({ exclusiveMinimum: 0 }),
});

export const ParsedPaperItemSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  studentAnswer: Type.Optional(Type.String()),
  coordinates: CoordinatesSchema,
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
});

export const ParsePaperOutputSchema = Type.Object({
  pages: Type.Array(
    Type.Object({
      page: Type.Integer({ minimum: 1 }),
      width: Type.Integer({ exclusiveMinimum: 0 }),
      height: Type.Integer({ exclusiveMinimum: 0 }),
    }),
  ),
  items: Type.Array(ParsedPaperItemSchema),
  coordinates: Type.Array(CoordinatesSchema),
  confidence: Type.Number({ minimum: 0, maximum: 1 }),
  warnings: Type.Array(Type.String()),
});

export type ParsePaperOutput = Static<typeof ParsePaperOutputSchema>;

export const ParsePaperResultSchema = toolResultSchema(ParsePaperOutputSchema);

