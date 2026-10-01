import type { Metadata } from "next";
import PitchViewer from "../../pitch/PitchViewer";
import { es } from "../../pitch/deck";

export const metadata: Metadata = {
  title: "Kosmovia · Presentación",
  robots: { index: false, follow: false },
  alternates: {
    canonical: "/es/pitch",
    languages: { en: "/pitch", es: "/es/pitch" },
  },
};

export default function PitchEs() {
  return <PitchViewer deck={es} />;
}
