import { useState, useEffect, useRef } from "react";
import { Bot, Loader2, Paperclip, SendHorizonal, User } from "lucide-react";
import { TierBadge } from "./Badges";
import { api } from "../api/client";
import { useToast } from "../App";
import type { AISystem, ChatMessage, ClassificationResult } from "../types";
import type { SectionKey } from "../config/questionnaire";
import {
  BUSINESS_QUESTIONS,
  TECHNICAL_QUESTIONS,
  getBusinessFieldValues,
  getTechnicalFieldValues,
} from "../config/questionnaire";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  system: AISystem;
  section: SectionKey;
  onClose: () => void;
  onSuccess: () => void;
}

function businessGreeting(name: string) {
  return `Hi! I'm here to capture the business context for "${name}". Let's start — in your own words, what is the primary purpose of this AI system?`;
}
function technicalGreeting(name: string) {
  return `Hi! I'll help assess the EU AI Act risk classification for "${name}". I'll ask about its technical characteristics and use cases. Let's start — does this system make decisions without human review (fully automated), or does a human review the outputs?`;
}

export default function QuestionnaireView({ open, system, section, onClose, onSuccess }: Props) {
  const [transcript, setTranscript] = useState<ChatMessage[]>([]);
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const showToast = useToast();

  const questions = section === "business" ? BUSINESS_QUESTIONS : TECHNICAL_QUESTIONS;

  useEffect(() => {
    if (!open) return;
    const greeting = section === "business" ? businessGreeting(system.name) : technicalGreeting(system.name);
    setTranscript([{ role: "assistant", content: greeting }]);
    setInput("");
    setBusy(false);
    setComplete(false);
    setDegraded(false);
    setClassification(null);
    setFields(section === "business"
      ? getBusinessFieldValues(system) as Record<string, unknown>
      : getTechnicalFieldValues(system));
  }, [open, system.id, section]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [transcript]);

  async function sendTurn(userMessage: string) {
    if (!userMessage.trim() || busy) return;
    const newMsg: ChatMessage = { role: "user", content: userMessage };
    const nextTranscript = [...transcript, newMsg];
    setTranscript(nextTranscript);
    setInput("");
    setBusy(true);
    try {
      const resp = await api.questionnaireTurn(system.id, section, nextTranscript, fields);
      const assistantMsg: ChatMessage = { role: "assistant", content: resp.message };
      setTranscript((t) => [...t, assistantMsg]);
      if (resp.extracted_fields && Object.keys(resp.extracted_fields).length > 0) {
        setFields((f) => ({ ...f, ...resp.extracted_fields }));
      }
      if (resp.complete) {
        setComplete(true);
        setDegraded(resp.degraded);
        if (resp.classification) setClassification(resp.classification);
      }
    } catch (e) {
      showToast(`AI assistant error: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setBusy(true);
    try {
      const resp = await api.questionnaireExtract(system.id, section, file);
      if (resp.extracted_fields && Object.keys(resp.extracted_fields).length > 0) {
        setFields((f) => ({ ...f, ...resp.extracted_fields }));
        const note = `I extracted the following from "${file.name}": ${Object.entries(resp.extracted_fields).map(([k, v]) => `${k}: ${v}`).join(", ")}.${resp.notes ? " " + resp.notes : ""}`;
        setTranscript((t) => [...t, { role: "assistant", content: note }]);
      } else {
        showToast("No fields extracted from the document", true);
      }
    } catch (e) {
      showToast(`Extract failed: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (section === "business") {
        const systemFields: Record<string, unknown> = {};
        const answerFields: Record<string, string> = {};
        for (const q of BUSINESS_QUESTIONS) {
          const val = fields[q.key];
          if (val == null) continue;
          if (q.storage === "system") systemFields[q.key] = val;
          else answerFields[q.key] = String(val);
        }
        await Promise.all([
          Object.keys(systemFields).length > 0 ? api.updateSystem(system.id, systemFields as never) : null,
          Object.keys(answerFields).length > 0 ? api.patchQuestionnaireAnswers(system.id, answerFields) : null,
        ].filter(Boolean));
      } else {
        const flagFields: Record<string, unknown> = {};
        for (const q of TECHNICAL_QUESTIONS) {
          const val = fields[q.key];
          if (val == null) continue;
          flagFields[q.key] = q.type === "number" ? Number(val) : Boolean(val);
        }
        if (Object.keys(flagFields).length > 0) await api.updateSystem(system.id, flagFields as never);
      }
      showToast("Progress saved");
    } catch (e) {
      showToast(`Save failed: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await handleSave();
      if (section === "business") {
        await api.submitBusinessSection(system.id);
      } else {
        await api.submitTechnicalSection(system.id);
      }
      showToast(section === "business"
        ? "Business section submitted — technical assignee notified"
        : "Technical section submitted — compliance officer notified");
      onSuccess();
    } catch (e) {
      showToast(`Submit failed: ${(e as Error).message}`, true);
    } finally {
      setSubmitting(false);
    }
  }

  const sectionTitle = section === "business" ? "Use Case & Context" : "AI Risk Classification";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent showCloseButton={false} className="flex max-h-[90vh] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
          <DialogTitle className="text-base">
            {sectionTitle} — {system.name}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Chat with the AI assistant or fill the form directly. Save your progress before submitting.
          </p>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* Chat pane */}
          <div className="flex w-1/2 flex-col border-r border-border">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {transcript.map((m, i) => (
                <div key={i} className={cn("flex gap-2.5", m.role === "user" && "flex-row-reverse")}>
                  <span className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white text-[10px] font-bold",
                    m.role === "user" ? "bg-[var(--brand)]" : "bg-muted-foreground",
                  )}>
                    {m.role === "user" ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
                  </span>
                  <div className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed",
                    m.role === "user"
                      ? "bg-[var(--brand)] text-white"
                      : "bg-muted text-foreground",
                  )}>
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex gap-2.5">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted-foreground text-white text-[10px]">
                    <Bot className="size-3.5" />
                  </span>
                  <div className="rounded-xl bg-muted px-3 py-2 text-[13px]">
                    <Loader2 className="size-3.5 animate-spin" />
                  </div>
                </div>
              )}
              {degraded && (
                <Alert variant="warning" className="text-xs">
                  Turn limit reached. Please review the form and submit manually.
                </Alert>
              )}
              {classification && section === "technical" && (
                <div className="rounded-xl border border-border bg-accent/40 px-3 py-2.5 text-[13px]">
                  <div className="mb-1 font-semibold">Preliminary classification:</div>
                  <div className="flex items-center gap-2">
                    <TierBadge tier={classification.tier} />
                    <span className="text-muted-foreground">{classification.basis}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-border px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground"
                  title="Upload document"
                  disabled={busy}
                >
                  <Paperclip className="size-4" />
                </button>
                <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.docx,.pptx,.png,.jpg,.jpeg" className="hidden" onChange={handleUpload} />
                <Input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTurn(input); } }}
                  placeholder={complete ? "Section complete — submit when ready" : "Type a message…"}
                  disabled={busy || complete}
                  className="flex-1 text-sm"
                />
                <button
                  onClick={() => sendTurn(input)}
                  disabled={!input.trim() || busy || complete}
                  className="flex size-8 items-center justify-center rounded-md bg-[var(--brand)] text-white disabled:opacity-40"
                >
                  <SendHorizonal className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Form pane */}
          <div className="w-1/2 overflow-y-auto px-5 py-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current Values
            </div>
            <div className="flex flex-col gap-3">
              {questions.map((q) => {
                const val = fields[q.key];
                if (q.type === "boolean") {
                  return (
                    <label key={q.key} className="flex items-start gap-2.5 rounded-md border border-border p-3 text-sm">
                      <Checkbox
                        checked={Boolean(val)}
                        onCheckedChange={(c) => setFields((f) => ({ ...f, [q.key]: c === true }))}
                        className="mt-0.5 shrink-0"
                      />
                      <div>
                        <div className="font-medium">{q.label}</div>
                        <div className="text-xs text-muted-foreground">{q.hint}</div>
                      </div>
                    </label>
                  );
                }
                if (q.type === "number") {
                  return (
                    <div key={q.key} className="flex flex-col gap-1">
                      <Label className="text-xs font-medium">{q.label}</Label>
                      <Input
                        type="number"
                        value={val != null ? String(val) : ""}
                        onChange={(e) => setFields((f) => ({ ...f, [q.key]: parseFloat(e.target.value) || 0 }))}
                        placeholder={q.hint}
                        className="text-sm"
                      />
                    </div>
                  );
                }
                if (q.type === "textarea") {
                  return (
                    <div key={q.key} className="flex flex-col gap-1">
                      <Label className="text-xs font-medium">{q.label}</Label>
                      <Textarea
                        value={val != null ? String(val) : ""}
                        onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))}
                        placeholder={q.hint}
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  );
                }
                return (
                  <div key={q.key} className="flex flex-col gap-1">
                    <Label className="text-xs font-medium">{q.label}</Label>
                    <Input
                      value={val != null ? String(val) : ""}
                      onChange={(e) => setFields((f) => ({ ...f, [q.key]: e.target.value }))}
                      placeholder={q.hint}
                      className="text-sm"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="shrink-0 sm:justify-start">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="outline" onClick={handleSave} disabled={saving || submitting}>
            {saving && <Loader2 className="animate-spin" />} Save Progress
          </Button>
          <Button onClick={handleSubmit} disabled={saving || submitting}>
            {submitting && <Loader2 className="animate-spin" />}
            Submit {section === "business" ? "Business" : "Technical"} Section
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
