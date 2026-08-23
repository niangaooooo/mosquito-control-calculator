import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "媒介伊蚊消杀配药计算器",
  description: "登革热 / 基孔肯雅热媒介防制辅助工具",
  manifest: "/mosquito/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="bg-gray-50 text-gray-900 min-h-screen antialiased">
        <div className="max-w-2xl mx-auto min-h-screen bg-white shadow-sm">
          {children}
        </div>
      </body>
    </html>
  );
}
