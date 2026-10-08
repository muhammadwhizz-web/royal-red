import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

// ROYAL RED typography law (Round 6): self-hosted fonts only. No Google Fonts
// runtime, no network fetch on compile. Three voices:
//   display  Cormorant Garamond  headings, wordmark, boot sequence
//   ui       Inter               body, panels, buttons
//   data     JetBrains Mono      numbers, code, logs, receipts
const display = localFont({
  src: "./fonts/cormorant-garamond-latin.woff2",
  variable: "--font-display",
  weight: "300 700",
  display: "swap",
  preload: true,
});

const ui = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-ui",
  weight: "100 900",
  display: "swap",
  preload: true,
});

const data = localFont({
  src: "./fonts/jetbrains-mono-latin.woff2",
  variable: "--font-data",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ROYAL RED / OS within OS",
  description:
    "ROYAL RED is a Linux-native agent operating system: it builds complete websites and apps, researches the web, manages accounts, and verifies every deliverable to 10/10.",
  keywords: ["ROYAL RED", "agent OS", "AI operating system", "website builder", "Linux"],
  authors: [{ name: "ROYAL RED" }],
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0606" },
    { media: "(prefers-color-scheme: light)", color: "#faf5f0" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${display.variable} ${ui.variable} ${data.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
