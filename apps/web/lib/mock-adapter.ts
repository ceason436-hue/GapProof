export type TodayMode = "new" | "regular" | "loading" | "empty" | "error";

export type TodayView = { mode: TodayMode; greeting: string; summary: string };

const supported = new Set<TodayMode>(["new", "regular", "loading", "empty", "error"]);

export function getMockTodayView(mode?: string): TodayView {
  const resolved: TodayMode = supported.has(mode as TodayMode) ? mode as TodayMode : "regular";
  if (resolved === "new") return { mode: resolved, greeting: "欢迎来到知隙", summary: "先从一次小检查开始，看看你卡在哪里。" };
  if (resolved === "empty") return { mode: resolved, greeting: "今天的任务完成了", summary: "下一次检查安排好后，会出现在这里。" };
  if (resolved === "error") return { mode: resolved, greeting: "暂时没能加载今日安排", summary: "你的学习判断没有改变，可以稍后再试。" };
  if (resolved === "loading") return { mode: resolved, greeting: "正在整理今日安排", summary: "可以先去做别的，完成后会出现在这里。" };
  return { mode: resolved, greeting: "早上好，同学！今天我们来解决“不规则动词”", summary: "这是合成演示状态，不代表真实学生记录。" };
}
