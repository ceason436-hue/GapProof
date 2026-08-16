import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApiClientError } from "@/lib/api-client";
import { SocraticTutorPanel, TutorConversationHistory, mergeTutorTurn, sessionContainsRecoveredSubmission, toTutorPanelError, tutorActionLabel } from "./socratic-tutor-panel";

const task = {
  id: "0198b111-1111-7000-8000-000000000012",
  caseId: "0198b111-1111-7000-8000-000000000002",
  studentId: "0198b111-1111-7000-8000-000000000003",
  taskType: "guided_intervention" as const,
  status: "ready" as const,
  title: "核对时态线索",
  rationale: "根据已确认的题目安排引导。",
  estimatedMinutes: 8,
  scheduledFor: "2026-08-16T00:00:00.000Z",
  dueAt: "2026-08-16T12:00:00.000Z",
  completedAt: null,
  steps: [{ id: "step-1", kind: "guided_practice" as const, title: "找出时间线索", content: "先找出句子里的时间表达。" }],
};

describe("SocraticTutorPanel", () => {
  it("starts with a read-only recovery state and gives privacy and single-question boundaries", () => {
    const html = renderToStaticMarkup(createElement(SocraticTutorPanel, { task, expectedVersion: 5 }));
    expect(html).toContain("正在读取上次的引导");
    expect(html).toContain("每次只问一个问题");
    expect(html).toContain("不要填写姓名、联系方式或其他个人信息");
    expect(html).toContain("不会代写答案");
    expect(html).not.toMatch(/个性化|已经掌握|学习效果|模型状态|provider/i);
  });

  it("presents task steps as plain-language choices instead of a technical select", () => {
    const multiStepTask = {
      ...task,
      steps: [
        ...task.steps,
        { id: "step-2", kind: "guided_practice" as const, title: "判断动词形式", content: "再判断动词应该使用哪种形式。" },
      ],
    };
    const html = renderToStaticMarkup(createElement(SocraticTutorPanel, { task: multiStepTask, expectedVersion: 5 }));
    expect(html).toContain("你想问哪一步？");
    expect(html).toContain("第 1 步");
    expect(html).toContain("第 2 步");
    expect(html).toContain("告诉导师你做到哪里、哪里不明白");
    expect(html).toContain("我找到了 yesterday");
    expect(html).not.toContain("正在思考：");
    expect(html).not.toContain("<select");
  });

  it("locks an unknown write result into read-only recovery", () => {
    expect(toTutorPanelError(new TypeError("connection closed"))).toEqual({
      code: "NETWORK_UNKNOWN",
      message: "暂时无法确认是否已经收到这次提问。为避免重复提问，请先读取最新状态。",
      retryable: false,
      unknownWriteResult: true,
    });
  });

  it("keeps actionable server causes instead of replacing them with a generic error", () => {
    const pending = new ApiClientError({
      error: { code: "TURN_ALREADY_PENDING", message: "pending", retryable: false },
      requestId: "request",
      traceId: "trace",
    }, 409);
    const conflict = new ApiClientError({
      error: { code: "VERSION_CONFLICT", message: "stale", retryable: false },
      requestId: "request",
      traceId: "trace",
    }, 409);
    expect(toTutorPanelError(pending)).toMatchObject({ code: "TURN_ALREADY_PENDING", message: "上一条引导还在准备，请读取最新状态。" });
    expect(toTutorPanelError(conflict)).toMatchObject({ code: "VERSION_CONFLICT", message: "任务内容已经更新，请返回今日查看最新安排。" });
  });

  it("maps every constrained next action to a student-operable continuation", () => {
    expect(tutorActionLabel("reflect")).toBe("回答这个问题");
    expect(tutorActionLabel("retry_step")).toBe("按提示再试这一步");
    expect(tutorActionLabel("ask_for_help")).toBe("再说说我卡在哪里");
  });

  it("renders the real student and tutor history while keeping hints collapsed", () => {
    const turns = [{
      turnId: "0198b111-1111-7000-8000-000000000021",
      taskId: task.id,
      status: "succeeded" as const,
      learnerText: "我先看到了 yesterday。",
      response: { question: "yesterday 对动词时态有什么提示？", hint: "比较动作发生的时间。", nextAction: "reflect" as const },
      retryable: false,
    }, {
      turnId: "0198b111-1111-7000-8000-000000000022",
      taskId: task.id,
      status: "succeeded" as const,
      learnerText: "它说明动作发生在过去。",
      response: { question: "那谓语动词应该怎样变化？", hint: null, nextAction: "retry_step" as const },
      retryable: false,
    }];
    const html = renderToStaticMarkup(createElement(TutorConversationHistory, {
      turns,
      activeTurnId: turns[1]!.turnId,
      visibleHintTurnIds: new Set<string>(),
      onRevealHint: () => undefined,
      onContinue: () => undefined,
    }));
    expect(html).toContain("我先看到了 yesterday");
    expect(html).toContain("yesterday 对动词时态有什么提示");
    expect(html).toContain("那谓语动词应该怎样变化");
    expect(html).toContain("我需要一点提示");
    expect(html).not.toContain("比较动作发生的时间");
    expect(html.match(/按提示再试这一步/g)).toHaveLength(1);
    expect(html).not.toMatch(/provider|model|token|errorCode/i);
  });

  it("merges a polled turn without duplicating its optimistic entry", () => {
    const turn = {
      turnId: "0198b111-1111-7000-8000-000000000021",
      taskId: task.id,
      status: "queued" as const,
      learnerText: "我先看时间线索。",
      response: null,
      retryable: true,
    };
    const queued = mergeTutorTurn(null, turn);
    const succeeded = mergeTutorTurn(queued, {
      ...turn,
      status: "succeeded",
      response: { question: "这个线索指向哪个时间？", hint: null, nextAction: "reflect" },
      retryable: false,
    });
    expect(succeeded.turns).toHaveLength(1);
    expect(succeeded.turns[0]?.status).toBe("succeeded");
  });

  it("does not mistake the previous turn for an unknown submission", () => {
    const oldTurn = {
      turnId: "0198b111-1111-7000-8000-000000000021",
      taskId: task.id,
      status: "succeeded" as const,
      learnerText: "旧的思路",
      response: { question: "旧问题？", hint: null, nextAction: "reflect" as const },
      retryable: false,
    };
    const marker = { baselineTurnId: oldTurn.turnId, learnerText: "这次新的思路" };
    expect(sessionContainsRecoveredSubmission({ taskId: task.id, turns: [oldTurn] }, marker)).toBe(false);
    expect(sessionContainsRecoveredSubmission({ taskId: task.id, turns: [oldTurn, {
      ...oldTurn,
      turnId: "0198b111-1111-7000-8000-000000000022",
      learnerText: marker.learnerText,
    }] }, marker)).toBe(true);
  });
});
