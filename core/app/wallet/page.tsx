import { WalletPanel } from "../../components/WalletPanel";

export default function Page() {
  return (
    <>
      <h1>Wallet</h1>
      <p className="muted">Tu dirección, tu saldo de XLM y USDC, y fondos de prueba.</p>
      <WalletPanel />
    </>
  );
}
