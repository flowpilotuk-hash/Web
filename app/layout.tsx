import "./globals.css";
import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";

export const metadata: Metadata = {
  title: "FlowPilot",
  description: "All-in-one automation platform for salon growth: social, booking, reviews.",
  applicationName: "FlowPilot",
  manifest: "/manifest.webmanifest",
  themeColor: "#7fff00",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {/* PWA / install */}
          <link rel="manifest" href="/manifest.webmanifest" />
          <meta name="theme-color" content="#7fff00" />

          {/* iOS “Add to Home Screen” */}
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-title" content="FlowPilot" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />

          {/* Basic */}
          <meta name="application-name" content="FlowPilot" />
        </head>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
