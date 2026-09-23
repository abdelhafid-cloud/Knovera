"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthSplitShell } from "@/components/auth/auth-split-shell";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname?.startsWith("/forgot-password")) {
    return children;
  }

  return <AuthSplitShell>{children}</AuthSplitShell>;
}
