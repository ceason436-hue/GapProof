import { describe, expect, it } from "vitest";

import { isCompleteProfileForm, profileSetupInitialValues } from "./student-profile-form";

const base = {
  studentId: "0198b111-1111-7000-8000-0000000000d2",
  timeZone: "Asia/Shanghai",
  version: 0,
  completed: false,
} as const;

describe("profile setup form", () => {
  it("requires explicit choices instead of silently selecting a learning range", () => {
    const form = profileSetupInitialValues({ ...base, grade: null, subject: null, term: null, region: null, learningState: null });
    expect(form).toEqual({ grade: "", subject: "", term: "", region: "", learningState: "" });
    expect(isCompleteProfileForm(form)).toBe(false);
  });

  it("retains an explicitly saved profile when the setup page is revisited", () => {
    const form = profileSetupInitialValues({ ...base, version: 1, completed: true, grade: "8", subject: "english", term: "first_term", region: "shanghai", learningState: "steady" });
    expect(isCompleteProfileForm(form)).toBe(true);
  });
});
