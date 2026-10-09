"use client";

import type { ReactNode } from "react";
import { DashboardFrame } from "@/components/layout/app-shell";
import { RequireAdminArea } from "@/components/layout/member-shell";

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdminArea mode="super">
      <DashboardFrame>{children}</DashboardFrame>
    </RequireAdminArea>
  );
}
