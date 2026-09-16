import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kosmovia · Explore. Connect. Belong.",
  description:
    "A free, Discord-style community platform for Stellar, with a built-in non-custodial wallet.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
