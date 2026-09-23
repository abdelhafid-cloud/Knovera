"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Historique accessible depuis chaque chat assistant. */
export default function UserHistoryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/user/assistants");
  }, [router]);
  return null;
}
