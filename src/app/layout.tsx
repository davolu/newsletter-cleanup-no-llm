import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newsletter cleanup",
  description: "Sort newsletter and promo mail with Gmail signals and a Jev classifier. Mail is never deleted.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
