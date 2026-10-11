import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Falk — the record settles the work",
  description:
    "Falk holds payment until independent GenLayer validators retrieve sealed public evidence and return per-criterion results. The contract alone derives the score and moves the money.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <WalletProvider>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </WalletProvider>
      </body>
    </html>
  );
}
