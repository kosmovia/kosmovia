import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kosmovia · Explore. Connect. Belong.",
  description:
    "A free social network for Stellar: communities, a feed, a built-in wallet and mini apps that run inside.",
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
