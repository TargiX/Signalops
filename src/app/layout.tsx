import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/app/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://signalops.cc"),
  title: {
    default: "SignalOps — AI Operations Evidence",
    template: "%s",
  },
  description:
    "Privacy-safe observability for AI operations, provider attempts, reliability, cost, and incident evidence.",
  openGraph: {
    title: "SignalOps — AI Operations Evidence",
    description:
      "Monitor AI operation and provider-attempt reliability without collecting prompts, media, or customer identity.",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SignalOps — AI Operations Evidence",
    description:
      "Monitor AI operation and provider-attempt reliability without collecting prompts, media, or customer identity.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="soft-light"
      className={`${inter.variable} ${jetBrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
