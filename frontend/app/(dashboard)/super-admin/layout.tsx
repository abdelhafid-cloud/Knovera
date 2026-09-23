"use client";

import type { ReactNode } from "react";
import { RequireAdminArea } from "@/components/layout/member-shell";

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return <RequireAdminArea mode="super">{children}</RequireAdminArea>;
}
