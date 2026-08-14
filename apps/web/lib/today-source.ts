export type TodaySource = "api" | "mock";

export function resolveTodaySource(source: string | undefined): TodaySource {
  return source === "mock" ? "mock" : "api";
}
