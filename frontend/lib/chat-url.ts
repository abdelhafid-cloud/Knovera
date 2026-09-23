export function assistantChatPath(assistantId: string, organizationId?: string | null) {
  const path = `/chat/${assistantId}`;
  if (!organizationId) return path;
  const q = new URLSearchParams({ org: organizationId });
  return `${path}?${q.toString()}`;
}

export function openAssistantChat(assistantId: string, organizationId?: string | null) {
  const url = assistantChatPath(assistantId, organizationId);
  window.open(url, "_blank", "noopener,noreferrer");
}
