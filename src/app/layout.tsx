import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
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
    <html lang="en" className={`${inter.variable} dark`}>
      <body className="min-h-dvh bg-[#09090b] text-zinc-50 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
