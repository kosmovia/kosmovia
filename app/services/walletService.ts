import { WalletTransaction } from '../types';
import { INITIAL_TRANSACTIONS } from './mockData';
import type { PaymentApproval } from './securityService';
import { storage } from './storage';

export interface WalletBalances {
  usdc: number;
  xlm: number;
}

export interface SendPaymentInput {
  to: string;
  amount: number;
  asset: 'USDC' | 'XLM';
  /**
   * El permiso que dio `securityService.approve` (PIN verificado). En modo api es
   * obligatorio: sin él no se paga. El pago va a `approval.toWallet`, con el monto y
   * el activo del permiso. El modo demo lo ignora.
   */
  approval?: PaymentApproval;
  /**
   * El cobro (`[COBRO_B2B:...]`) que este pago liquida, por id de su mensaje. El
   * servidor comprueba que siga abierto y que quien paga sea el destinatario, y
   * lo liga al pago para que no se pueda pagar dos veces (migración 0018).
   */
  invoiceMessageId?: string;
}

export interface IWalletService {
  getPublicKey(): Promise<string>;
  getBalances(publicKey: string): Promise<WalletBalances>;
  getTransactions(publicKey: string): Promise<WalletTransaction[]>;
  sendPayment(input: SendPaymentInput): Promise<WalletTransaction>;
}

const STORAGE_BALANCES_KEY = 'kosmovia_wallet_balances';
const STORAGE_TX_KEY = 'kosmovia_wallet_transactions';

const DEFAULT_PUBLIC_KEY = 'GD26UBYVEYYVVOVCMOLPMIKPWQRFV34LK3I7LHBNTUGYHYIKFMEREH2A';
const DEFAULT_BALANCES: WalletBalances = { usdc: 185.0, xlm: 42.8 };

export class MockWalletService implements IWalletService {
  async getPublicKey(): Promise<string> {
    return DEFAULT_PUBLIC_KEY;
  }

  async getBalances(_publicKey: string): Promise<WalletBalances> {
    await new Promise((r) => setTimeout(r, 40));
    return storage.get<WalletBalances>(STORAGE_BALANCES_KEY, DEFAULT_BALANCES);
  }

  async getTransactions(_publicKey: string): Promise<WalletTransaction[]> {
    await new Promise((r) => setTimeout(r, 50));
    return storage.get<WalletTransaction[]>(STORAGE_TX_KEY, INITIAL_TRANSACTIONS);
  }

  async sendPayment(input: SendPaymentInput): Promise<WalletTransaction> {
    await new Promise((r) => setTimeout(r, 120)); // Simula firma con Passkey / Soroban RPC

    const balances = await this.getBalances(DEFAULT_PUBLIC_KEY);
    if (input.asset === 'USDC') {
      balances.usdc = Math.max(0, balances.usdc - input.amount);
    } else {
      balances.xlm = Math.max(0, balances.xlm - input.amount);
    }
    storage.set(STORAGE_BALANCES_KEY, balances);

    const newTx: WalletTransaction = {
      id: `tx-${Date.now()}`,
      type: 'sent',
      counterparty: input.to,
      amount: input.amount,
      asset: input.asset,
      timestamp: 'Ahora mismo',
      hash: '6be268a284eee59916485c32eadc2d89d092c1b14c60443969cb504996147181',
    };

    const txs = await this.getTransactions(DEFAULT_PUBLIC_KEY);
    storage.set(STORAGE_TX_KEY, [newTx, ...txs]);

    return newTx;
  }
}
