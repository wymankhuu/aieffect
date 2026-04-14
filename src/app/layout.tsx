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
          href="/"
          className="fixed left-6 top-4 z-50 inline-flex items-center"
          aria-label="The AI Effect — home"
        >
          <span className="bg-gradient-to-r from-[#1A1033] to-[#FF6699] bg-clip-text font-serif text-xl font-bold tracking-tight text-transparent sm:text-2xl">
            The AI Effect
          </span>
        </Link>
        {children}
        <footer className="fixed bottom-0 left-0 right-0 z-40 flex flex-col items-center gap-3 bg-[#FAF4E8]/90 py-3 text-center text-xs text-[#6B5F87] font-sans backdrop-blur-sm sm:flex-row sm:justify-center sm:gap-6 sm:py-4">
          <Link
            href="https://playlab.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center"
            aria-label="Playlab"
          >
            <Image
              src="/playlab-logo.png"
              alt="Playlab"
              width={120}
              height={28}
              className="h-7 w-auto"
            />
          </Link>
          <Link
            href="https://www.bankstreet.edu/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center"
            aria-label="Bank Street"
          >
            <Image
              src="/bankstreet-logo.png"
              alt="Bank Street"
              width={28}
              height={28}
              className="h-7 w-auto"
            />
          </Link>
          <span>
            Inspired by{" "}
            <a
              href="https://www.therithmproject.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#1A1033] underline decoration-[#FF3366] decoration-2 underline-offset-4 transition-colors hover:text-[#FF3366]"
            >
              The Rithm Project
            </a>
          </span>
        </footer>
      </body>
    </html>
  );
}
