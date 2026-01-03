"use client";

import React, { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { Drawer } from "./ui/drawer";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { ChartRenderer } from "./chart-renderer";
import { AgentResponse, ChartSpec } from "@/lib/types";
import { loadPinned, savePinned } from "@/lib/pinned";

type Props = {
  trigger?: "button" | "floating";
  buttonLabel?: string;
  onPin?: (spec: ChartSpec) => void;
};

export function ChatAnalyst({ trigger = "button", buttonLabel = "Ask Analyst", onPin }: Props) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "agent"; content: string; chartSpec?: ChartSpec }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadPinned(); // warm up localStorage
  }, []);

  const ask = async () => {
    if (!question.trim()) return;
    const q = question.trim();
    setQuestion("");
    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);
    try {
      const res = await fetch("/api/agent/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      const data: AgentResponse = await res.json();
      setMessages((m) => [...m, { role: "agent", content: data.textAnswer, chartSpec: data.chartSpec }]);
    } catch (err) {
      setMessages((m) => [...m, { role: "agent", content: "Unable to process request." }]);
    } finally {
      setLoading(false);
    }
  };

  const pinChart = (spec: ChartSpec) => {
    const existing = loadPinned();
    const entry = { id: uuid(), title: spec.title, chartSpec: spec, createdAt: new Date().toISOString() };
    savePinned([entry, ...existing].slice(0, 20));
    onPin?.(spec);
  };

  const triggerButton =
    trigger === "floating" ? (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-6 z-40 flex items-center gap-2 rounded-full bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-2xl transition hover:-translate-y-0.5 hover:shadow-[0_20px_60px_rgba(15,23,42,0.35)]"
      >
        <span className="text-lg">💬</span>
        <span>{buttonLabel}</span>
      </button>
    ) : (
      <Button variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
        {buttonLabel}
      </Button>
    );

  return (
    <>
      {triggerButton}
      <Drawer open={open} onClose={() => setOpen(false)} title="Chat Analyst (read-only)">
        <div className="flex flex-col gap-3">
          <div className="space-y-2">
            <Input
              placeholder="Ask about spending, merchants, or trends..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask()}
              disabled={loading}
            />
            <Button onClick={ask} disabled={loading}>
              {loading ? "Thinking..." : "Send"}
            </Button>
          </div>

          <div className="space-y-3">
            {messages.map((m, idx) => (
              <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">{m.role}</div>
                <div className="text-slate-800">{m.content}</div>
                {m.chartSpec && (
                  <div className="mt-2 space-y-2">
                    <ChartRenderer spec={m.chartSpec} />
                    <Button variant="outline" onClick={() => pinChart(m.chartSpec!)}>
                      Pin chart to dashboard
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </Drawer>
    </>
  );
}
