import type { Metadata } from "next";
import Home from "./home/Home";

const title = "Kosmovia · Tu comunidad y tu dinero, en un solo lugar";
const description =
  "Chat, wallet en dólares digitales (USDC) y pagos entre personas sobre Stellar. Hecho en Bolivia, para el mundo. Beta gratis en Stellar testnet.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/", languages: { es: "/", en: "/en" } },
  openGraph: { type: "website", siteName: "Kosmovia", locale: "es_LA", url: "/", title, description },
  twitter: { card: "summary", title, description },
};

export default function Page() {
  return <Home />;
}
