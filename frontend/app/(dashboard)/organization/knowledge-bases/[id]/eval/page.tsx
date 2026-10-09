"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { EvalQuestion, KnowledgeBase } from "@/lib/types";
import { DashboardShell, EmptyState, PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppModal } from "@/components/ui/app-modal";

export default function KbEvalPage() {
  const params = useParams();
  const kbId = String(params.id || "");

  const [kb, setKb] = useState<KnowledgeBase | null>(null);
  const [questions, setQuestions] = useState<EvalQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({ question: "", expected_answer: "" });

  const load = async () => {
    const [kbRes, qRes] = await Promise.all([
      api.get<KnowledgeBase>(`/api/knowledge-bases/${kbId}`),
      api.get<EvalQuestion[]>(`/api/knowledge-bases/${kbId}/eval-questions`),
    ]);
    setKb(kbRes.data);
    setQuestions(qRes.data || []);
  };

  useEffect(() => {
    if (!kbId) return;
    setLoading(true);
    load()
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [kbId]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.post(`/api/knowledge-bases/${kbId}/eval-questions`, {
        question: form.question.trim(),
        expected_answer: form.expected_answer.trim() || undefined,
      });
      toast.success("Question ajoutée");
      setForm({ question: "", expected_answer: "" });
      setCreateOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (qid: string) => {
    if (!confirm("Supprimer cette question ?")) return;
    setBusyId(qid);
    try {
      await api.delete(`/api/knowledge-bases/${kbId}/eval-questions/${qid}`);
      toast.success("Question supprimée");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <DashboardShell
      title="Évaluation RAG"
      breadcrumbs={["Organisation", "KB", kb?.name || kbId, "Évaluation"]}
    >
      <PageHeader
        description="Questions golden pour mesurer la qualité des réponses sur cette knowledge base."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/organization/knowledge-bases">
                <ArrowLeft className="size-4" />
                Retour
              </Link>
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Ajouter
            </Button>
          </div>
        }
      />

      <div className="overflow-hidden rounded-xl border border-border">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : questions.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Aucune question d'évaluation" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Réponse attendue</TableHead>
                <TableHead className="w-[80px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="max-w-md whitespace-pre-wrap">{q.question}</TableCell>
                  <TableCell className="max-w-md text-muted-foreground whitespace-pre-wrap">
                    {q.expected_answer || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-destructive"
                      disabled={busyId === q.id}
                      onClick={() => remove(q.id)}
                    >
                      {busyId === q.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <AppModal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        labelledBy="eval-q-title"
        className="max-w-lg"
      >
        <h2 id="eval-q-title" className="text-lg font-semibold">
          Nouvelle question golden
        </h2>
        <form onSubmit={create} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label>Question</Label>
            <Input
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Réponse attendue (optionnel)</Label>
            <Input
              value={form.expected_answer}
              onChange={(e) => setForm({ ...form, expected_answer: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="size-4 animate-spin" /> : "Ajouter"}
            </Button>
          </div>
        </form>
      </AppModal>
    </DashboardShell>
  );
}
