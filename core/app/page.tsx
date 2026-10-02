import { LoginPanel } from "../components/LoginPanel";

export default function Page() {
  return (
    <>
      <h1>Entrar</h1>
      <p className="muted">Entra con Google, email o Freighter. Todo corre en testnet.</p>
      <LoginPanel />
    </>
  );
}
