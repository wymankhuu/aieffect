import type { Metadata } from "next";
import { Playfair_Display, Source_Sans_3 } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";

const serif = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const sans = Source_Sans_3({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "The AI Effect",
  description:
    "A game to uncover how AI can strengthen human connection, and when it might pull us apart.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-background text-foreground font-sans antialiased">
        <Link
          href="https://playlab.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="fixed left-4 top-4 z-50 inline-flex items-center"
          aria-label="Playlab"
        >
          <Image
            src="/playlab-logo.png"
            alt="Playlab"
            width={120}
            height={32}
            priority
            className="h-8 w-auto"
          />
        </Link>
        {children}
        <footer className="relative z-10 py-6 text-center text-xs text-[#6B5F87] font-sans">
          Inspired by{" "}
          <a
            href="https://www.therithmproject.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[#1A1033] underline decoration-[#FF3366] decoration-2 underline-offset-4 transition-colors hover:text-[#FF3366]"
          >
            The Rithm Project
          </a>
        </footer>
      </body>
    </html>
  );
}
