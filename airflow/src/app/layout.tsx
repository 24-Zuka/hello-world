import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AIRFLOW — Task Board",
  description: "AI×human hybrid task board",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
