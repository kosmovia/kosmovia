import type { Metadata } from "next";
import Landing from "../Landing";
import { es } from "../content";

export const metadata: Metadata = {
  title: "Kosmovia · Explora. Conecta. Pertenece.",
  description:
    "Comunidades con wallet y pagos integrados, en Stellar. Empezamos en Bolivia, pensado para el mundo.",
  alternates: { canonical: "/es", languages: { en: "/", es: "/es" } },
};

export default function Home() {
  return <Landing lang="es" content={es} />;
}
