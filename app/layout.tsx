import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "streetSim",
  description:
    "Render any NYC block from real city data, redesign it as a shared street, and see honest before/after numbers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
