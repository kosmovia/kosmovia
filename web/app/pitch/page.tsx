import type { Metadata } from "next";
import PitchViewer from "./PitchViewer";
import { en } from "./deck";

export const metadata: Metadata = {
  title: "Kosmovia · Pitch deck",
  robots: { index: false, follow: false },
  alternates: {
    canonical: "/pitch",
    languages: { en: "/pitch", es: "/es/pitch" },
  },
};

export default function Pitch() {
  return <PitchViewer deck={en} />;
}
