import { describe, expect, it } from "vitest";
import {
  parseApiOrigin,
  parseDemoStudentId,
  serverApiUrl,
} from "./runtime-config";

describe("server runtime configuration", () => {
  it("maps the browser BFF path to an absolute server API URL", () => {
    expect(serverApiUrl("http://127.0.0.1:3001", "/api/v1/students/demo/today"))
      .toBe("http://127.0.0.1:3001/v1/students/demo/today");
  });

  it.each([undefined, "", "   "])("rejects a missing API origin", value => {
    expect(() => parseApiOrigin(value)).toThrowError(
      expect.objectContaining({ code: "API_ORIGIN_MISSING" }),
    );
  });

  it.each([
    "not-a-url",
    "ftp://api.example.test",
    "https://api.example.test/v1",
    "https://user:pass@api.example.test",
    "https://api.example.test?token=secret",
  ])("rejects an unsafe API origin: %s", value => {
    expect(() => parseApiOrigin(value)).toThrowError(
      expect.objectContaining({ code: "API_ORIGIN_INVALID" }),
    );
  });

  it.each([undefined, ""])("rejects a missing demo student ID", value => {
    expect(() => parseDemoStudentId(value)).toThrowError(
      expect.objectContaining({ code: "DEMO_STUDENT_ID_MISSING" }),
    );
  });

  it("accepts only a UUID demo student ID", () => {
    expect(parseDemoStudentId(" 11111111-1111-4111-8111-111111111111 "))
      .toBe("11111111-1111-4111-8111-111111111111");
    expect(() => parseDemoStudentId("student-1")).toThrowError(
      expect.objectContaining({ code: "DEMO_STUDENT_ID_INVALID" }),
    );
  });
});
