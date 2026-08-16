import {
  isTutorTurnJobData,
  type SocraticTutorContext,
  type SocraticTutorOutput,
  type ToolRequest,
} from "@gapproof/contracts";
import {
  claimTutorTurn,
  failTutorTurn,
  findTutorTurn,
  finishTutorTurn,
  type Database,
  type TutorTurnRow,
} from "@gapproof/db";
import type { JobQueue } from "@gapproof/jobs";
import {
  createSocraticTutorAdapterFromEnvironment,
  ruleTutorFallback,
  type SocraticTutorAdapter,
} from "@gapproof/tools";

function isStoredTutorContext(value: unknown): value is SocraticTutorContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.subject === "string" && candidate.subject.length > 0 && candidate.subject.length <= 40 &&
    typeof candidate.grade === "string" && candidate.grade.length > 0 && candidate.grade.length <= 40 &&
    typeof candidate.taskTitle === "string" && candidate.taskTitle.length > 0 && candidate.taskTitle.length <= 160 &&
    typeof candidate.stepTitle === "string" && candidate.stepTitle.length > 0 && candidate.stepTitle.length <= 120 &&
    typeof candidate.stepContent === "string" && candidate.stepContent.length > 0 && candidate.stepContent.length <= 1_000 &&
    typeof candidate.learnerText === "string" && candidate.learnerText.length > 0 && candidate.learnerText.length <= 800;
}

interface TutorTurnStore {
  find(turnId: string): Promise<TutorTurnRow | undefined>;
  claim(turnId: string): Promise<TutorTurnRow | undefined>;
  finish(input: {
    turnId: string;
    status: "succeeded" | "fallback";
    response: SocraticTutorOutput;
    provider: "deepseek" | "rule_fallback";
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    errorCode?: string;
  }): Promise<TutorTurnRow | undefined>;
  fail(turnId: string, errorCode: string): Promise<TutorTurnRow | undefined>;
}

export interface TutorTurnWorkerOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly tutor?: Pick<SocraticTutorAdapter, "execute">;
  readonly store?: TutorTurnStore;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

function databaseStore(database: Database): TutorTurnStore {
  return {
    find: (turnId) => findTutorTurn(database, turnId),
    claim: (turnId) => claimTutorTurn(database, turnId),
    finish: (input) => finishTutorTurn(database, input),
    fail: (turnId, errorCode) => failTutorTurn(database, turnId, errorCode),
  };
}

export function createTutorTurnWorker(options: TutorTurnWorkerOptions) {
  const store = options.store ?? databaseStore(options.database);
  const tutor = options.tutor ?? createSocraticTutorAdapterFromEnvironment(options.env ?? process.env);
  let workerId: string | undefined;

  return {
    async start() {
      workerId = await options.queue.workTutorTurn(async (job) => {
        if (!isTutorTurnJobData(job.data)) throw new Error("The tutor turn job payload is invalid.");
        const existing = await store.find(job.data.turnId);
        if (existing === undefined) throw new Error("TUTOR_TURN_NOT_FOUND");
        if (existing.status === "succeeded" || existing.status === "fallback" || existing.status === "failed") {
          return { turnId: existing.id, status: existing.status, idempotentReplay: true };
        }
        const turn = await store.claim(existing.id);
        if (turn === undefined) return { turnId: existing.id, status: existing.status, idempotentReplay: true };
        if (!isStoredTutorContext(turn.context)) {
          await store.fail(turn.id, "INVALID_STORED_CONTEXT");
          return { turnId: turn.id, status: "failed" };
        }
        const context = turn.context as SocraticTutorContext;
        const request: ToolRequest<SocraticTutorContext> = {
          toolCallId: `tutor-turn:${turn.id}`,
          caseId: "redacted-case",
          studentId: "redacted-student",
          traceId: job.data.traceId,
          input: context,
          policyVersion: "socratic-tutor-v1",
        };

        let result = await tutor.execute(request);
        if (result.status !== "succeeded" && result.error?.retryable === true) {
          result = await tutor.execute(request);
        }
        if (result.status === "succeeded" && result.data !== undefined) {
          await store.finish({
            turnId: turn.id,
            status: "succeeded",
            response: result.data,
            provider: "deepseek",
            ...(result.model === undefined ? {} : { model: result.model }),
            ...(result.usage === undefined ? {} : {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
            }),
          });
          return { turnId: turn.id, status: "succeeded" };
        }

        const errorCode = result.error?.code ?? "TUTOR_PROVIDER_FAILED";
        await store.finish({
          turnId: turn.id,
          status: "fallback",
          response: ruleTutorFallback(context),
          provider: "rule_fallback",
          errorCode,
        });
        return { turnId: turn.id, status: "fallback" };
      });
      return workerId;
    },
    async stop() {
      if (workerId !== undefined) {
        await options.queue.stopTutorTurnWorker(workerId);
        workerId = undefined;
      }
    },
  };
}
