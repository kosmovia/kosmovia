"use client";

import type { ReactNode } from "react";
import { PollarAppProvider } from "../lib/pollar.tsx";
import { AccountSetupProvider } from "../hooks/useAccountSetup.tsx";

/** Everything the session needs, mounted once in app/layout.tsx. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <PollarAppProvider>
      <AccountSetupProvider>{children}</AccountSetupProvider>
    </PollarAppProvider>
  );
}
