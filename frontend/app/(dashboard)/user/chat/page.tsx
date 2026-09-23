"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Chat intégré dashboard retiré pour les membres — utiliser /chat/[id]. */
export default function UserChatRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/user/assistants");
  }, [router]);
  return null;
}
