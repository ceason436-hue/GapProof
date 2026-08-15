import AlibabaOcrClient, {
  RecognizeEduPaperOcrRequest,
} from "@alicloud/ocr-api20210707";
import { $OpenApiUtil } from "@alicloud/openapi-core";
import * as $dara from "@darabonba/typescript";
import type { Readable } from "node:stream";

import type { ParsePaperOutput } from "@gapproof/contracts";

import {
  AlibabaOcrTransportError,
  type AlibabaOcrTransport,
  type AlibabaOcrTransportRequest,
  type AlibabaOcrTransportResponse,
} from "./alibaba-ocr-spike.ts";

export const DEFAULT_ALIBABA_OCR_ENDPOINT =
  "ocr-api.cn-hangzhou.aliyuncs.com";
export const DEFAULT_ALIBABA_EDU_IMAGE_TYPE = "scan";
export const DEFAULT_ALIBABA_EDU_SUBJECT = "JHighSchool_English";

export type AlibabaEduImageType = "scan" | "photo";
export type AlibabaEduSubject =
  | "default"
  | "English"
  | "PrimarySchool_English"
  | "JHighSchool_English";

interface AlibabaEduPaperSdkResponse {
  readonly statusCode?: number;
  readonly body?: {
    readonly code?: string;
    readonly data?: unknown;
  };
}

export interface AlibabaEduPaperSdkClient {
  recognizeEduPaperOcrWithOptions(
    request: RecognizeEduPaperOcrRequest,
    runtime: $dara.RuntimeOptions,
  ): Promise<AlibabaEduPaperSdkResponse>;
}

export interface AlibabaEduPaperSdkTransportOptions {
  readonly accessKeyId: string;
  readonly accessKeySecret: string;
  readonly securityToken?: string;
  readonly endpoint?: string;
  readonly imageType?: AlibabaEduImageType;
  readonly subject?: AlibabaEduSubject;
  readonly clientFactory?: (
    config: $OpenApiUtil.Config,
  ) => AlibabaEduPaperSdkClient;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validEndpoint(endpoint: string): boolean {
  if (endpoint.length === 0 || endpoint.includes("/")) return false;
  try {
    const parsed = new URL(`https://${endpoint}`);
    return (
      parsed.hostname === endpoint &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function requiredSecret(value: string, name: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number > 0
    ? number
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function normalizedConfidence(value: unknown): number {
  const number = finiteNumber(value);
  if (number === undefined) return 0;
  return Math.min(1, Math.max(0, number / 100));
}

export function normalizeAlibabaEduPaperResponse(
  data: unknown,
): ParsePaperOutput | undefined {
  let raw: unknown = data;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!isRecord(raw)) return undefined;

  const width = positiveInteger(raw.width);
  const height = positiveInteger(raw.height);
  if (width === undefined || height === undefined) return undefined;

  const rawWords = Array.isArray(raw.prism_wordsInfo)
    ? raw.prism_wordsInfo
    : [];
  const items: ParsePaperOutput["items"] = [];
  for (const rawWord of rawWords) {
    if (!isRecord(rawWord)) continue;
    const prompt =
      typeof rawWord.word === "string" ? rawWord.word.trim() : "";
    const x = nonNegativeNumber(rawWord.x);
    const y = nonNegativeNumber(rawWord.y);
    const itemWidth = finiteNumber(rawWord.width);
    const itemHeight = finiteNumber(rawWord.height);
    if (
      prompt.length === 0 ||
      x === undefined ||
      y === undefined ||
      itemWidth === undefined ||
      itemWidth <= 0 ||
      itemHeight === undefined ||
      itemHeight <= 0
    ) {
      continue;
    }
    items.push({
      id: `alibaba-word-${items.length + 1}`,
      prompt,
      coordinates: {
        page: 1,
        x,
        y,
        width: itemWidth,
        height: itemHeight,
      },
      confidence: normalizedConfidence(rawWord.prob),
    });
  }

  const confidence =
    items.length === 0
      ? 0
      : items.reduce((sum, item) => sum + item.confidence, 0) /
        items.length;
  return {
    pages: [{ page: 1, width, height }],
    items,
    coordinates: items.map((item) => ({ ...item.coordinates })),
    confidence,
    warnings: [],
  };
}

function thrownStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error.statusCode ?? error.status;
  return typeof status === "number" && Number.isInteger(status)
    ? status
    : undefined;
}

function thrownCode(error: unknown): string {
  if (!isRecord(error)) return "";
  const value = error.code ?? error.name;
  return typeof value === "string" ? value.toLowerCase() : "";
}

export class AlibabaEduPaperSdkTransport implements AlibabaOcrTransport {
  private readonly client: AlibabaEduPaperSdkClient;
  private readonly imageType: AlibabaEduImageType;
  private readonly subject: AlibabaEduSubject;

  constructor(options: AlibabaEduPaperSdkTransportOptions) {
    const accessKeyId = requiredSecret(
      options.accessKeyId,
      "Alibaba Cloud access key ID",
    );
    const accessKeySecret = requiredSecret(
      options.accessKeySecret,
      "Alibaba Cloud access key secret",
    );
    const endpoint = options.endpoint ?? DEFAULT_ALIBABA_OCR_ENDPOINT;
    if (!validEndpoint(endpoint)) {
      throw new Error("Alibaba OCR endpoint must be a bare HTTPS hostname.");
    }
    const config = new $OpenApiUtil.Config({
      accessKeyId,
      accessKeySecret,
      ...(options.securityToken === undefined
        ? {}
        : { securityToken: options.securityToken }),
      endpoint,
      protocol: "https",
    });
    this.client = (options.clientFactory ?? ((value) => new AlibabaOcrClient(value)))(
      config,
    );
    this.imageType = options.imageType ?? DEFAULT_ALIBABA_EDU_IMAGE_TYPE;
    this.subject = options.subject ?? DEFAULT_ALIBABA_EDU_SUBJECT;
  }

  async execute(
    request: AlibabaOcrTransportRequest,
  ): Promise<AlibabaOcrTransportResponse> {
    return this.executeRequest(
      new RecognizeEduPaperOcrRequest({
        url: request.sourceUrl,
        imageType: this.imageType,
        subject: this.subject,
        outputOricoord: false,
      }),
      request.timeoutMs,
      request.signal,
    );
  }

  async executeBody(options: {
    readonly body: Readable;
    readonly timeoutMs: number;
    readonly signal: AbortSignal;
  }): Promise<AlibabaOcrTransportResponse> {
    return this.executeRequest(
      new RecognizeEduPaperOcrRequest({
        body: options.body,
        imageType: this.imageType,
        subject: this.subject,
        outputOricoord: false,
      }),
      options.timeoutMs,
      options.signal,
    );
  }

  private async executeRequest(
    sdkRequest: RecognizeEduPaperOcrRequest,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<AlibabaOcrTransportResponse> {
    if (signal.aborted) {
      throw new AlibabaOcrTransportError("timeout");
    }
    try {
      const response = await this.client.recognizeEduPaperOcrWithOptions(
        sdkRequest,
        new $dara.RuntimeOptions({
          autoretry: false,
          connectTimeout: timeoutMs,
          readTimeout: timeoutMs,
        }),
      );
      if (signal.aborted) {
        throw new AlibabaOcrTransportError("timeout");
      }
      const status = response.statusCode ?? 200;
      if (status < 200 || status > 299) return { status, payload: undefined };
      if (response.body?.code !== undefined) {
        const code = response.body.code.toLowerCase();
        return {
          status: code.includes("permission") ? 403 : 400,
          payload: undefined,
        };
      }
      return {
        status,
        payload: normalizeAlibabaEduPaperResponse(response.body?.data),
      };
    } catch (error) {
      if (error instanceof AlibabaOcrTransportError) throw error;
      const status = thrownStatus(error);
      if (status !== undefined) return { status, payload: undefined };
      const code = thrownCode(error);
      if (code.includes("timeout") || code.includes("etimedout")) {
        throw new AlibabaOcrTransportError("timeout");
      }
      throw new AlibabaOcrTransportError("network");
    }
  }
}

export function createAlibabaEduPaperSdkTransportFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): AlibabaEduPaperSdkTransport {
  const securityToken = env.ALIBABA_CLOUD_SECURITY_TOKEN?.trim();
  return new AlibabaEduPaperSdkTransport({
    accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID ?? "",
    accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ?? "",
    ...(securityToken === undefined || securityToken.length === 0
      ? {}
      : { securityToken }),
    ...(env.ALIBABA_OCR_ENDPOINT === undefined
      ? {}
      : { endpoint: env.ALIBABA_OCR_ENDPOINT }),
  });
}
