import { describe, expect, it } from "vitest";
import { tutorTurnLimitDecision } from "./tutor-repository.ts";

describe("tutor turn limits", () => {
  it("allows a turn only below both limits with no outstanding work", () => {
    expect(tutorTurnLimitDecision(5, 11, false)).toBeNull();
    expect(tutorTurnLimitDecision(6, 0, false)).toBe("TASK_LIMIT_REACHED");
    expect(tutorTurnLimitDecision(0, 12, false)).toBe("DAILY_LIMIT_REACHED");
    expect(tutorTurnLimitDecision(0, 0, true)).toBe("TURN_ALREADY_PENDING");
  });
});
