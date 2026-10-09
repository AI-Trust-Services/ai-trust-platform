import { useState, useRef, useEffect } from "react";
import { Bot, Send, Loader2, AlertCircle } from "lucide-react";
import { api } from "../api/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  text: string;
  articles?: string[];
  error?: boolean;
}

export default function RagChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await api.ragAsk(q);
      setMessages((m) => [...m, { role: "assistant", text: res.answer, articles: res.articles }]);
    } catch (e) {
      const msg = (e as Error).message;
      const isUnavailable = msg.includes("503") || msg.toLowerCase().includes("no index") || msg.toLowerCase().includes("not supported");
      setMessages((m) => [...m, {
        role: "assistant",
        text: isUnavailable
          ? "The EU AI Act assistant is not available yet — the index hasn't been built in this deployment."
          : `Error: ${msg}`,
        error: true,
      }]);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div className="flex flex-col gap-0 rounded-md border border-border overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Bot className="size-4 text-[var(--brand)]" />
        <span className="text-sm font-medium">EU AI Act Assistant</span>
        <span className="ml-auto text-xs text-muted-foreground">2026 consolidated text</span>
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto p-4" style={{ maxHeight: 360 }}>
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Ask anything about the EU AI Act — obligations, articles, definitions, timelines.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
              m.role === "user"
                ? "bg-[var(--brand)] text-white"
                : m.error
                  ? "border border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2"
                  : "border border-border bg-muted/40 text-foreground",
            )}>
              {m.error && <AlertCircle className="size-3.5 mt-0.5 shrink-0" />}
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.articles && m.articles.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.articles.map((a) => (
                    <span key={a} className="rounded-full border border-[var(--brand)]/30 bg-[var(--brand)]/10 px-2 py-0.5 text-[11px] text-[var(--brand)]">{a}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t border-border p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about obligations, articles, definitions…"
          rows={2}
          className="resize-none text-sm"
          disabled={busy}
        />
        <Button size="sm" onClick={send} disabled={busy || !input.trim()} className="self-end shrink-0">
          {busy ? <Loader2 className="animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
