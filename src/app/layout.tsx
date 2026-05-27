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
  metadataBase: new URL("https://signalops.ilyamoskovkin.com"),
  title: "SignalOps — AI Generation Operations",
  description:
    "A dense React operations cockpit for AI image-generation products.",
  openGraph: {
    title: "SignalOps — AI Generation Operations",
    description:
      "Custom React dashboard with TanStack Table, Virtual, Query, incident triage, and routing-rule simulation.",
    images: [{ url: "/opengraph-image" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SignalOps — AI Generation Operations",
    description:
      "Custom React dashboard with TanStack Table, Virtual, Query, incident triage, and routing-rule simulation.",
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
