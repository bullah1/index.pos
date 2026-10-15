import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { askAssistant } from "@/lib/assistant.functions";

export const Route = createFileRoute("/_authenticated/assistant")({
  head: () => ({
    meta: [
      { title: "Ask AI — Pharmacy POS" },
      { name: "description", content: "Ask questions about sales, customer dues and expenses in plain language." },
      { property: "og:title", content: "Ask AI — Pharmacy POS" },
      { property: "og:description", content: "AI-powered answers and suggestions from your shop data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Assistant,
});

type Msg = { role: "user" | "assistant"; content: string };
const EXAMPLES = ["এই সপ্তাহে মোট বিক্রি ও লাভ কত?", "কোন গ্রাহকদের বাকি সবচেয়ে বেশি, কী করা উচিত?", "Which expenses grew this month?", "Which medicines earn the most profit?"];

function Assistant() {
  const { role } = Route.useRouteContext();
  const ask = useServerFn(askAssistant);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (messages: Msg[]) => ask({ data: { messages } }),
    onSuccess: (r, sent) => {
      if (r.ok) setMsgs([...sent, { role: "assistant", content: r.text }]);
      else { setError(r.error); setMsgs(sent.slice(0, -1)); setInput(sent.at(-1)?.content ?? ""); }
    },
    onError: (_e, sent) => { setError("Could not reach the assistant."); setMsgs(sent.slice(0, -1)); setInput(sent.at(-1)?.content ?? ""); },
  });

  if (role !== "admin" && role !== "manager") return <p className="text-muted-foreground">Only managers can use the assistant.</p>;

  function send(text: string) {
    const t = text.trim();
    if (!t || m.isPending) return;
    const next = [...msgs, { role: "user" as const, content: t }].slice(-20);
    setError(null); setInput(""); setMsgs(next); m.mutate(next);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Sparkles className="h-5 w-5 text-primary" />Ask AI</h1>
        <p className="text-sm text-muted-foreground">Ask about the last 60 days of sales, all customer dues and expenses, in Bangla or English.</p>
      </div>
      {msgs.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <Button key={e} variant="outline" size="sm" onClick={() => send(e)}>{e}</Button>)}
        </div>
      )}
      <div className="space-y-3">
        {msgs.map((x, i) => (
          <div key={i} className={x.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "rounded-lg border bg-card p-3"}>
            {x.role === "user" ? x.content : <div className="space-y-2 text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_strong]:font-semibold [&_h3]:font-semibold"><ReactMarkdown>{x.content}</ReactMarkdown></div>}
          </div>
        ))}
        {m.isPending && <div className="rounded-lg border p-3 text-sm text-muted-foreground">Looking at your shop data…</div>}
        {error && <div className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div>}
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <Textarea rows={2} value={input} placeholder="Type your question…" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} />
        <Button type="submit" disabled={m.isPending || !input.trim()}>Ask</Button>
      </form>
      {msgs.length > 0 && <Button variant="ghost" size="sm" className="self-start" onClick={() => { setMsgs([]); setError(null); }}>New conversation</Button>}
    </div>
  );
}
