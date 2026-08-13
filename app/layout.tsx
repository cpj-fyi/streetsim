import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://streets.cpj.fyi"),
  title: {
    default: "streetSim",
    template: "%s · streetSim",
  },
  description:
    "Render any NYC block from real city data, redesign it as a shared street, and see honest, cited before and after numbers.",
  openGraph: {
    siteName: "streetSim",
    type: "website",
    url: "https://streets.cpj.fyi",
    title: "streetSim",
    description:
      "Render any NYC block from real city data, redesign it as a shared street, and see honest, cited before and after numbers.",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://use.typekit.net" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://use.typekit.net/joj4bxo.css" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
