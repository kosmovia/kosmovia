import type { Metadata } from "next";
import Landing from "./Landing";
import { en } from "./content";

export const metadata: Metadata = {
  title: "Kosmovia · Explore. Connect. Belong.",
  description:
    "Communities with a wallet and payments built in, on Stellar. Starting in Bolivia, built for the world.",
  alternates: { canonical: "/", languages: { en: "/", es: "/es" } },
};

export default function Home() {
  return <Landing lang="en" content={en} />;
}
