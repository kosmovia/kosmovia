import type { Metadata } from "next";
import Landing from "./Landing";
import { en } from "./content";

export const metadata: Metadata = {
  title: "Kosmovia · Explore. Connect. Belong.",
  description:
    "Communities with a wallet and payments built in, on Stellar. Starting in Bolivia, built for the world.",
  alternates: { canonical: "/", languages: { en: "/", es: "/es" } },
  openGraph: {
    type: "website",
    siteName: "Kosmovia",
    locale: "en_US",
    url: "/",
    title: "Kosmovia · Explore. Connect. Belong.",
    description:
      "Communities with a wallet and payments built in, on Stellar. Starting in Bolivia, built for the world.",
  },
  twitter: {
    card: "summary",
    title: "Kosmovia · Explore. Connect. Belong.",
    description:
      "Communities with a wallet and payments built in, on Stellar. Starting in Bolivia, built for the world.",
  },
};

export default function Home() {
  return <Landing lang="en" content={en} />;
}
