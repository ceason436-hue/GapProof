import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "知隙 GapProof", description: "可验证的错因修复学习助手" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
