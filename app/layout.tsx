import type { Metadata } from "next";
import { Geist, Inter } from "next/font/google";
import { Header } from "@/components/Header";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Turnaround Guard",
  description: "Fleet turnaround and conflict checks for rental operators",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geist.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Header />
        <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
