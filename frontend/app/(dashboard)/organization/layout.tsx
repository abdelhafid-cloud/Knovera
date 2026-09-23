"use client";

import type { ReactNode } from "react";
import { RequireAdminArea } from "@/components/layout/member-shell";

export default function OrganizationLayout({ children }: { children: ReactNode }) {
  return <RequireAdminArea mode="org">{children}</RequireAdminArea>;
}
