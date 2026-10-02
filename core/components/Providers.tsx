"use client";

import type { ReactNode } from "react";
import { PollarAppProvider } from "../lib/pollar.tsx";
import { AccountSetupProvider } from "../hooks/useAccountSetup.tsx";
import { SessionBridge } from "./SessionBridge.tsx";

/** Everything the session needs, mounted once in app/layout.tsx. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <PollarAppProvider>
      <AccountSetupProvider>
        <SessionBridge />
        {children}
      </AccountSetupProvider>
    </PollarAppProvider>
  );
}
