"use client";

import { useCallback, useEffect, useState } from "react";
import { usePollar } from "@pollar/react";
import { WalletType } from "@pollar/core";
import type { AuthState, PollarUserProfile, WalletInfo } from "@pollar/core";
import { clearProofCache } from "../lib/auth-client.ts";

export interface PollarUser {
  /** Stellar address: the user's id in Kosmovia. */
  address: string;
  /** Email, name and avatar. In memory only: null after a reload until the SDK re-verifies the session. */
  profile: PollarUserProfile | null;
  /** Custody, login provider, funding mode. */
  wallet: WalletInfo;
}

/** Steps where the SDK is waiting on the user, not working. */
const SETTLED_STEPS: AuthState["step"][] = [
  "idle",
  "authenticated",
  "error",
  "entering_email",
  "entering_code",
  "wallet_not_installed",
];

/**
 * Single auth entry point. Sessions persist in the SDK's own storage; after a
 * reload the user is restored automatically. Only call it under <PollarGate>.
 */
export function usePollarAuth() {
  const { isAuthenticated, verified, wallet, logout, openLoginModal, login, getClient } = usePollar();
  const [authState, setAuthState] = useState<AuthState>({ step: "idle" });

  useEffect(() => {
    // Fires with the current state, then on every change; returns its unsubscribe.
    return getClient().onAuthStateChange((state) => setAuthState(state));
  }, [getClient]);

  const user: PollarUser | null =
    isAuthenticated && wallet
      ? { address: wallet.address, profile: getClient().getUserProfile(), wallet }
      : null;

  const step = authState.step;
  let error: string | null = null;
  if (step === "error") error = authState.message || "No se pudo iniciar sesión. Intenta de nuevo.";
  if (step === "wallet_not_installed") error = "No encontramos la extensión de Freighter en este navegador.";

  const loginGoogle = useCallback(() => login({ provider: "google" }), [login]);
  const loginFreighter = useCallback(() => login({ provider: WalletType.FREIGHTER }), [login]);
  const doLogout = useCallback(() => {
    clearProofCache();
    logout();
  }, [logout]);

  return {
    user,
    /** True while the SDK is mid-login (OAuth window, OTP check, wallet connection). */
    isLoading: !SETTLED_STEPS.includes(step),
    error,
    /** False while a restored session awaits server confirmation. */
    verified,
    loginGoogle,
    /** Opens Pollar's modal, which includes the email + code flow. */
    loginEmail: openLoginModal,
    loginFreighter,
    logout: doLogout,
  };
}
