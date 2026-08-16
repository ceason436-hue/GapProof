import { describe, expect, it } from "vitest";
import { TUTOR_MAX_TURNS_PER_TASK, TUTOR_SESSION_HISTORY_LIMIT } from "@gapproof/contracts";
import { tutorTurnLimitDecision } from "./tutor-repository.ts";

describe("tutor turn limits", () => {
  it("allows a turn only below both limits with no outstanding work", () => {
    expect(tutorTurnLimitDecision(5, 11, false)).toBeNull();
    expect(tutorTurnLimitDecision(6, 0, false)).toBe("TASK_LIMIT_REACHED");
    expect(tutorTurnLimitDecision(0, 12, false)).toBe("DAILY_LIMIT_REACHED");
    expect(tutorTurnLimitDecision(0, 0, true)).toBe("TURN_ALREADY_PENDING");
  });

  it("keeps the complete task session within the same six-turn product limit", () => {
    expect(TUTOR_SESSION_HISTORY_LIMIT).toBe(6);
    expect(TUTOR_SESSION_HISTORY_LIMIT).toBe(TUTOR_MAX_TURNS_PER_TASK);
  });
});
