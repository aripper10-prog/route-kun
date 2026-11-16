
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "るーと君｜焦燥・迷走思考整理ツール",
  description: "最終地点（山頂）から逆算して、今日踏み出す最初の一歩を可視化する思考整理ナビ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}
