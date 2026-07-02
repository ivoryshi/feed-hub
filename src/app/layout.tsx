import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Feed Hub — 投研信息聚合",
  description: "个人投研信息收集与检索知识库",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="min-h-full bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
