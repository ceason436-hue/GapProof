import { describe, expect, it } from "vitest";
import { diagnosisModeForEvidence, reconstructConfirmedDiagnosisItems } from "./run-next-worker.ts";

describe("real diagnosis confirmed evidence reconstruction", () => {
  it("uses only confirmed items and applies the student's prompt and answer corrections", () => {
    const items = reconstructConfirmedDiagnosisItems(
      { extraction: { items: [{ itemId: "item-1", prompt: "OCR 原文" }, { itemId: "item-2", prompt: "不应进入诊断" }] } },
      { confirmedItemIds: ["item-1"], corrections: [{ itemId: "item-1", field: "prompt", value: "学生确认题目" }, { itemId: "item-1", field: "student_answer", value: "学生答案" }] },
    );
    expect(items).toEqual([{ prompt: "学生确认题目", studentAnswer: "学生答案" }]);
    expect(JSON.stringify(items)).not.toContain("不应进入诊断");
  });

  it("rejects inconsistent confirmation evidence", () => {
    expect(reconstructConfirmedDiagnosisItems(
      { extraction: { items: [{ itemId: "item-1", prompt: "题目" }] } },
      { confirmedItemIds: ["unknown"], corrections: [] },
    )).toBeUndefined();
  });

  it("never selects the Mina fixture path for a real Alibaba Case", () => {
    expect(diagnosisModeForEvidence({ synthetic: false, simulation: false, extractionSourceType: "real_alibaba_ocr", confirmationSourceType: "student_confirmation" })).toBe("real");
    expect(diagnosisModeForEvidence({ synthetic: false, simulation: false, extractionSourceType: "fake_ocr", confirmationSourceType: "student_confirmation" })).toBe("invalid");
    expect(diagnosisModeForEvidence({ synthetic: true, simulation: true, extractionSourceType: "fake_ocr", confirmationSourceType: "student_confirmation" })).toBe("synthetic");
  });
});
