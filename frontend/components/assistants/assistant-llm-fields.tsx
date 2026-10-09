"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { LlmProviderOption } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AssistantLlmFormSlice = {
  llm_provider: string;
  model: string;
  system_prompt: string;
  temperature: number;
  welcome_message: string;
};

type Props = {
  value: AssistantLlmFormSlice;
  onChange: (patch: Partial<AssistantLlmFormSlice>) => void;
  /** Requis pour générer le prompt */
  name: string;
  description: string;
  knowledgeBaseId: string;
  knowledgeBaseLabel?: string;
  /** Force le header org (ex. super-admin créant dans une autre org) */
  organizationId?: string;
  disabled?: boolean;
};

async function withOrgContext<T>(orgId: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!orgId) return fn();
  const previous = api.organizationId;
  api.setOrganizationId(orgId);
  try {
    return await fn();
  } finally {
    api.setOrganizationId(previous);
  }
}

export function AssistantLlmFields({
  value,
  onChange,
  name,
  description,
  knowledgeBaseId,
  knowledgeBaseLabel,
  organizationId,
  disabled,
}: Props) {
  const [providers, setProviders] = useState<LlmProviderOption[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setLoadingProviders(true);
    withOrgContext(organizationId, () =>
      api.get<LlmProviderOption[]>("/api/assistants/llm-providers")
    )
      .then((r) => {
        const list = r.data || [];
        setProviders(list);
        const current =
          list.find((p) => p.id === value.llm_provider) ||
          list.find((p) => p.configured) ||
          list[0];
        if (current) {
          const modelOk = current.models.some((m) => m.id === value.model);
          if (!modelOk || value.llm_provider !== current.id) {
            onChange({
              llm_provider: current.id,
              model: current.models[0]?.id || value.model,
            });
          }
        }
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoadingProviders(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init catalogue une fois
  }, [organizationId]);

  const currentProvider = useMemo(
    () => providers.find((p) => p.id === value.llm_provider),
    [providers, value.llm_provider]
  );

  const onProviderChange = (providerId: string) => {
    const p = providers.find((x) => x.id === providerId);
    onChange({
      llm_provider: providerId,
      model: p?.models[0]?.id || "",
    });
  };

  const generatePrompt = async () => {
    if (!name.trim() || !knowledgeBaseId) {
      toast.error("Renseignez d’abord le nom et la knowledge base");
      return;
    }
    setGenerating(true);
    try {
      const r = await withOrgContext(organizationId, () =>
        api.post<{ system_prompt: string }>("/api/assistants/generate-prompt", {
          name: name.trim(),
          description: description.trim() || undefined,
          knowledge_base_id: knowledgeBaseId,
          llm_provider: value.llm_provider,
          model: value.model,
        })
      );
      onChange({ system_prompt: r.data.system_prompt });
      toast.success("Prompt généré — vous pouvez le modifier");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Génération impossible");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Provider LLM</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={value.llm_provider}
            onChange={(e) => onProviderChange(e.target.value)}
            disabled={disabled || loadingProviders}
            required
          >
            {loadingProviders ? (
              <option>Chargement…</option>
            ) : (
              providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.configured}>
                  {p.label}
                  {!p.configured ? " (clé manquante)" : ""}
                </option>
              ))
            )}
          </select>
          {currentProvider ? (
            <p className="text-[11px] text-muted-foreground">{currentProvider.description}</p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label>Modèle</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={value.model}
            onChange={(e) => onChange({ model: e.target.value })}
            disabled={disabled || loadingProviders || !currentProvider}
            required
          >
            {(currentProvider?.models || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Température</Label>
          <Input
            type="number"
            min={0}
            max={1.5}
            step={0.1}
            value={value.temperature}
            onChange={(e) => onChange({ temperature: Number(e.target.value) })}
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label>Message d’accueil</Label>
          <Input
            value={value.welcome_message}
            onChange={(e) => onChange({ welcome_message: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <Label>System prompt</Label>
            <p className="text-[11px] text-muted-foreground">
              Généré selon le nom, la description et la KB
              {knowledgeBaseLabel ? ` « ${knowledgeBaseLabel} »` : ""}. Modifiable.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={generatePrompt}
            disabled={disabled || generating || !name.trim() || !knowledgeBaseId}
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Générer le prompt
          </Button>
        </div>
        <textarea
          className="min-h-[280px] max-h-[50vh] w-full overflow-y-auto rounded-md border border-input bg-background px-3 py-2 font-mono text-[13px] leading-relaxed"
          value={value.system_prompt}
          onChange={(e) => onChange({ system_prompt: e.target.value })}
          placeholder="Cliquez sur « Générer le prompt » pour un prompt structuré (rôle, sources, si pas de réponse, reformulation…) ou rédigez-le ici."
          disabled={disabled}
        />
      </div>
    </div>
  );
}
