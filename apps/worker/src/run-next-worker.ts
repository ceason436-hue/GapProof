import type { CaseAggregate, RunNextJobData } from "@gapproof/contracts";
import {
  and,
  eq,
  findCaseById,
  findLatestCaseEvidenceEventByType,
  learningEvidenceEvents,
  persistCaseTransition,
  persistGeneratedIntervention,
  type Database,
} from "@gapproof/db";
import { transitionCase } from "@gapproof/domain";
import type { JobQueue } from "@gapproof/jobs";
import {
  FakeFormHypothesesAdapter,
  buildRealDiagnosisContextPack,
  type FormHypothesesAdapter,
  FakeBuildInterventionAdapter,
  type BuildInterventionAdapter,
  FakeParsePaperAdapter,
  type ParsePaperAdapter,
} from "@gapproof/tools";
import { v7 as uuidv7 } from "uuid";
import { assertSyntheticDemoParse } from "./run-next-guard.ts";

export interface RunNextWorkerOptions {
  readonly database: Database;
  readonly queue: JobQueue;
  readonly parsePaper?: ParsePaperAdapter;
  readonly formHypotheses?: FormHypothesesAdapter;
  readonly realFormHypotheses?: FormHypothesesAdapter;
  readonly buildIntervention?: BuildInterventionAdapter;
}

type ConfirmedDiagnosisItem = { prompt: string; studentAnswer?: string };

export function diagnosisModeForEvidence(input: {
  synthetic: boolean;
  simulation: boolean;
  extractionSourceType: string;
  confirmationSourceType: string;
}): "synthetic" | "real" | "invalid" {
  if (input.synthetic && input.simulation && input.extractionSourceType === "fake_ocr" && input.confirmationSourceType === "student_confirmation") return "synthetic";
  if (!input.synthetic && !input.simulation && input.extractionSourceType === "real_alibaba_ocr" && input.confirmationSourceType === "student_confirmation") return "real";
  return "invalid";
}

export function reconstructConfirmedDiagnosisItems(
  extractionPayload: Record<string, unknown>,
  confirmationPayload: Record<string, unknown>,
): readonly ConfirmedDiagnosisItem[] | undefined {
  const extraction = typeof extractionPayload.extraction === "object" && extractionPayload.extraction !== null ? extractionPayload.extraction as Record<string, unknown> : undefined;
  if (!Array.isArray(extraction?.items) || !Array.isArray(confirmationPayload.confirmedItemIds) || !Array.isArray(confirmationPayload.corrections)) return undefined;
  const confirmedIds = new Set(confirmationPayload.confirmedItemIds.filter((value): value is string => typeof value === "string"));
  const corrections = new Map<string, { prompt?: string; studentAnswer?: string }>();
  for (const raw of confirmationPayload.corrections) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const correction = raw as Record<string, unknown>;
    if (typeof correction.itemId !== "string" || typeof correction.value !== "string" || (correction.field !== "prompt" && correction.field !== "student_answer")) return undefined;
    const value = corrections.get(correction.itemId) ?? {};
    if (correction.field === "prompt") value.prompt = correction.value;
    else value.studentAnswer = correction.value;
    corrections.set(correction.itemId, value);
  }
  const result: ConfirmedDiagnosisItem[] = [];
  for (const raw of extraction.items) {
    if (typeof raw !== "object" || raw === null) return undefined;
    const item = raw as Record<string, unknown>;
    if (typeof item.itemId !== "string" || typeof item.prompt !== "string") return undefined;
    if (!confirmedIds.has(item.itemId)) continue;
    const correction = corrections.get(item.itemId);
    const prompt = correction?.prompt ?? item.prompt;
    if (prompt.trim().length === 0) return undefined;
    result.push({ prompt, ...(correction?.studentAnswer === undefined ? {} : { studentAnswer: correction.studentAnswer }) });
  }
  return result.length === confirmedIds.size && result.length > 0 ? result : undefined;
}

export function createRunNextWorker(options: RunNextWorkerOptions) {
  const parsePaper =
    options.parsePaper ?? new FakeParsePaperAdapter("low_confidence");
  const formHypotheses =
    options.formHypotheses ?? new FakeFormHypothesesAdapter();
  const realFormHypotheses = options.realFormHypotheses;
  const buildIntervention =
    options.buildIntervention ?? new FakeBuildInterventionAdapter();
  let workerId: string | undefined;

  return {
    async start() {
      workerId = await options.queue.workRunNext(async (job) => {
        const eventIdempotencyKey = `run-next-job:${job.id}`;
        const [existingEvent] = await options.database
          .select({ id: learningEvidenceEvents.id })
          .from(learningEvidenceEvents)
          .where(
            eq(
              learningEvidenceEvents.idempotencyKey,
              eventIdempotencyKey,
            ),
          )
          .limit(1);

        const caseRow = await findCaseById(options.database, job.data.caseId);
        if (caseRow === undefined) {
          throw new Error(`Case ${job.data.caseId} was not found.`);
        }

        if (existingEvent !== undefined) {
          return {
            caseId: caseRow.id,
            state: caseRow.state,
            stateVersion: caseRow.stateVersion,
            idempotentReplay: true,
          };
        }

        if (caseRow.state === "intervention_ready") {
          const probeEvaluationEvent = await findLatestCaseEvidenceEventByType(
            options.database,
            caseRow.id,
            "probe_evaluated",
          );
          if (probeEvaluationEvent === undefined) {
            throw new Error("PROBE_EVALUATION_EVIDENCE_NOT_FOUND");
          }
          const replanEvent = await findLatestCaseEvidenceEventByType(
            options.database,
            caseRow.id,
            "plan_replanned",
          );
          const replanStrategy = replanEvent?.payload.strategy === "prerequisite_skill_with_example"
            ? "prerequisite_skill_with_example"
            : replanEvent?.payload.strategy === "alternate_explanation_and_practice"
              ? "alternate_explanation_and_practice"
              : null;
          const evaluationResult = probeEvaluationEvent.payload.result;
          if (
            typeof evaluationResult !== "object" ||
            evaluationResult === null ||
            !("passed" in evaluationResult) ||
            typeof evaluationResult.passed !== "boolean" ||
            !("selectedHypothesisId" in evaluationResult) ||
            !(
              typeof evaluationResult.selectedHypothesisId === "string" ||
              evaluationResult.selectedHypothesisId === null
            )
          ) {
            throw new Error("INVALID_PROBE_EVALUATION_EVENT");
          }

          const toolResult = await buildIntervention.execute({
            toolCallId: `build-intervention:${job.id}`,
            caseId: caseRow.id,
            studentId: caseRow.studentId,
            traceId: job.data.traceId,
            input: {
              probeEvaluationEventId: probeEvaluationEvent.id,
              selectedHypothesisId:
                evaluationResult.selectedHypothesisId,
              probePassed: evaluationResult.passed,
            },
            policyVersion: "demo-intervention-policy-v1",
          });
          if (
            toolResult.status !== "succeeded" ||
            toolResult.data === undefined
          ) {
            throw new Error(
              toolResult.error?.code ?? "BUILD_INTERVENTION_FAILED",
            );
          }
          const stepIds = toolResult.data.steps.map(({ id }) => id);
          if (
            toolResult.data.steps.length < 3 ||
            new Set(stepIds).size !== stepIds.length ||
            !toolResult.evidenceRefs.includes(probeEvaluationEvent.id)
          ) {
            throw new Error("INVALID_INTERVENTION_TOOL_RESULT");
          }

          const taskId = uuidv7();
          const occurredAt = new Date();
          const event = {
            eventId: uuidv7(),
            occurredAt: occurredAt.toISOString(),
            type: "intervention_generated" as const,
            taskId,
          };
          const next = transitionCase(
            {
              id: caseRow.id,
              status: caseRow.state,
              mastery: "insufficient_evidence",
              version: caseRow.stateVersion,
              replanCount: caseRow.replanCount,
              appliedEventIds: [],
            },
            event,
          );
          const persisted = await persistGeneratedIntervention(
            options.database,
            {
              caseId: caseRow.id,
              expectedVersion: job.data.expectedVersion,
              nextState: next.status,
              event: {
                id: event.eventId,
                tenantId: caseRow.tenantId,
                studentId: caseRow.studentId,
                caseId: caseRow.id,
                eventType: event.type,
                sourceType: "fake_intervention",
                sourceRef: toolResult.toolVersion,
                payload: {
                  taskId,
                  probeEvaluationEventId: probeEvaluationEvent.id,
                  ...(replanStrategy === null ? {} : { replanStrategy }),
                  toolVersion: toolResult.toolVersion,
                  warnings: [...toolResult.warnings],
                },
                confidence: toolResult.confidence?.toFixed(4),
                occurredAt,
                idempotencyKey: eventIdempotencyKey,
              },
              task: {
                id: taskId,
                tenantId: caseRow.tenantId,
                studentId: caseRow.studentId,
                caseId: caseRow.id,
                taskType: "guided_intervention",
                status: "ready",
                title: replanStrategy === "alternate_explanation_and_practice"
                  ? "换一种讲解与练习方式"
                  : replanStrategy === "prerequisite_skill_with_example"
                    ? "回到前置技能并结合示例"
                    : toolResult.data.title,
                estimatedMinutes: toolResult.data.estimatedMinutes,
                scheduledFor: occurredAt,
                payload: {
                  rationale: replanStrategy === "alternate_explanation_and_practice"
                    ? "规则化合成骨架：更换讲解表达与练习形式。"
                    : replanStrategy === "prerequisite_skill_with_example"
                      ? "规则化合成骨架：下探一个前置技能并加入示例。"
                      : toolResult.data.rationale,
                  steps: toolResult.data.steps,
                  ...(replanStrategy === null ? {} : { replanStrategy }),
                  warnings: [...toolResult.warnings],
                  toolVersion: toolResult.toolVersion,
                },
                sourceEventId: event.eventId,
              },
            },
          );

          return {
            caseId: caseRow.id,
            state: persisted.state,
            stateVersion: persisted.stateVersion,
            taskId,
            idempotentReplay: false,
          };
        }

        if (caseRow.state === "ready_for_diagnosis") {
          const [confirmationEvent] = await options.database
            .select()
            .from(learningEvidenceEvents)
            .where(
              and(
                eq(learningEvidenceEvents.caseId, caseRow.id),
                eq(
                  learningEvidenceEvents.eventType,
                  "recognition_confirmed",
                ),
              ),
            )
            .limit(1);

          if (confirmationEvent === undefined) {
            throw new Error("CONFIRMED_EXTRACTION_EVIDENCE_NOT_FOUND");
          }

          const extractionEvent = await findLatestCaseEvidenceEventByType(
            options.database,
            caseRow.id,
            "evidence_ingested",
          );
          if (extractionEvent === undefined) throw new Error("EXTRACTION_EVIDENCE_NOT_FOUND");
          const diagnosisMode = diagnosisModeForEvidence({ synthetic: caseRow.synthetic, simulation: caseRow.simulation, extractionSourceType: extractionEvent.sourceType, confirmationSourceType: confirmationEvent.sourceType });
          if (diagnosisMode === "invalid") {
            throw new Error("REAL_DIAGNOSIS_EVIDENCE_INVALID");
          }
          const isRealDiagnosis = diagnosisMode === "real";
          const realContext = isRealDiagnosis
            ? buildRealDiagnosisContextPack(
                reconstructConfirmedDiagnosisItems(extractionEvent.payload, confirmationEvent.payload) ?? [],
              )
            : undefined;
          if (isRealDiagnosis && realContext === undefined) {
            throw new Error("REAL_DIAGNOSIS_CONTEXT_NOT_AVAILABLE");
          }
          const selectedAdapter = isRealDiagnosis ? realFormHypotheses : formHypotheses;
          if (selectedAdapter === undefined) throw new Error("REAL_DIAGNOSIS_PROVIDER_NOT_CONFIGURED");

          const toolResult = await selectedAdapter.execute({
            toolCallId: `form-hypotheses:${job.id}`,
            caseId: caseRow.id,
            studentId: caseRow.studentId,
            traceId: job.data.traceId,
            input: {
              observedPrompt: isRealDiagnosis
                ? realContext!.text
                : "Mina has ___ (write) three short notes about saving water this week.",
              observedAnswer: isRealDiagnosis ? "not_separately_provided" : "wrote",
              confirmedEvidenceRefs: [confirmationEvent.id],
            },
            policyVersion: isRealDiagnosis ? "real-diagnosis-policy-v1" : "demo-diagnosis-policy-v1",
          });

          if (
            toolResult.status !== "succeeded" ||
            toolResult.data === undefined
          ) {
            throw new Error(
              toolResult.error?.code ?? "FORM_HYPOTHESES_FAILED",
            );
          }

          const hypothesisIds = toolResult.data.candidates.map(
            (candidate) => candidate.id,
          );
          const hypothesisIdSet = new Set(hypothesisIds);
          if (
            hypothesisIdSet.size < 2 ||
            toolResult.data.candidates.some(
              (candidate) =>
                !candidate.evidenceRefs.includes(confirmationEvent.id),
            ) ||
            toolResult.data.probe.testedHypothesisIds.some(
              (hypothesisId) => !hypothesisIdSet.has(hypothesisId),
            ) ||
            !toolResult.data.probe.choices.some(
              (choice) =>
                choice.id === toolResult.data?.probe.expectedChoiceId,
            )
          ) {
            throw new Error("INVALID_HYPOTHESES_TOOL_RESULT");
          }

          const aggregate: CaseAggregate = {
            id: caseRow.id,
            status: caseRow.state,
            mastery: "insufficient_evidence",
            version: caseRow.stateVersion,
            replanCount: caseRow.replanCount,
            appliedEventIds: [],
          };
          const event = {
            eventId: uuidv7(),
            occurredAt: new Date().toISOString(),
            type: "hypotheses_generated" as const,
            hypothesisIds,
          };
          const next = transitionCase(aggregate, event);
          const persisted = await persistCaseTransition(options.database, {
            caseId: caseRow.id,
            expectedVersion: job.data.expectedVersion,
            nextState: next.status,
            event: {
              id: event.eventId,
              tenantId: caseRow.tenantId,
              studentId: caseRow.studentId,
              caseId: caseRow.id,
              eventType: event.type,
              sourceType: isRealDiagnosis ? "deepseek_diagnosis" : "fake_diagnosis",
              sourceRef: toolResult.toolVersion,
              payload: {
                candidates: toolResult.data.candidates,
                probe: toolResult.data.probe,
                warnings: [...toolResult.warnings],
                toolVersion: toolResult.toolVersion,
              },
              confidence: toolResult.confidence?.toFixed(4),
              occurredAt: new Date(event.occurredAt),
              idempotencyKey: eventIdempotencyKey,
            },
          });

          return {
            caseId: caseRow.id,
            state: persisted.state,
            stateVersion: persisted.stateVersion,
            idempotentReplay: false,
          };
        }

        if (caseRow.state !== "awaiting_evidence") {
          throw new Error(`RUN_NEXT_NOT_ALLOWED_FROM_${caseRow.state}`);
        }

        assertSyntheticDemoParse(caseRow, job.data.assetId);

        const toolResult = await parsePaper.execute({
          toolCallId: `parse-paper:${job.id}`,
          caseId: caseRow.id,
          studentId: caseRow.studentId,
          traceId: job.data.traceId,
          input: {
            assetId: job.data.assetId,
            provider: "fake",
            pageHints: ["single-page", "synthetic-demo"],
          },
          policyVersion: "demo-policy-v1",
        });

        if (
          toolResult.status === "retryable_error" ||
          toolResult.status === "failed" ||
          toolResult.data === undefined
        ) {
          throw new Error(toolResult.error?.code ?? "PARSE_PAPER_FAILED");
        }

        const aggregate: CaseAggregate = {
          id: caseRow.id,
          status: caseRow.state,
          mastery: "insufficient_evidence",
          version: caseRow.stateVersion,
          replanCount: caseRow.replanCount,
          appliedEventIds: [],
        };
        const lowConfidenceRegionCount = toolResult.warnings.filter((warning) =>
          warning.startsWith("LOW_CONFIDENCE_REGION:"),
        ).length;
        const event = {
          eventId: uuidv7(),
          occurredAt: new Date().toISOString(),
          type: "evidence_ingested" as const,
          lowConfidenceRegionCount,
        };
        const next = transitionCase(aggregate, event);

        const persisted = await persistCaseTransition(options.database, {
          caseId: caseRow.id,
          expectedVersion: job.data.expectedVersion,
          nextState: next.status,
          event: {
            id: event.eventId,
            tenantId: caseRow.tenantId,
            studentId: caseRow.studentId,
            caseId: caseRow.id,
            eventType: event.type,
            sourceType: "fake_ocr",
            sourceRef: job.data.assetId,
            payload: {
              lowConfidenceRegionCount,
              extraction: {
                items: toolResult.data.items.map(({ id, prompt }) => ({
                  itemId: id,
                  prompt,
                })),
              },
              toolVersion: toolResult.toolVersion,
              warnings: [...toolResult.warnings],
            },
            confidence: toolResult.confidence?.toFixed(4),
            occurredAt: new Date(event.occurredAt),
            idempotencyKey: eventIdempotencyKey,
          },
        });

        return {
          caseId: caseRow.id,
          state: persisted.state,
          stateVersion: persisted.stateVersion,
          idempotentReplay: false,
        };
      });

      return workerId;
    },

    async stop() {
      if (workerId !== undefined) {
        await options.queue.stopWorker(workerId);
        workerId = undefined;
      }
    },
  };
}
