"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Output comparison: ask the SAME prompts to a base model and a fine-tuned model,
 * show the answers side by side. Runs SEQUENTIALLY because a modest GPU only
 * holds one model in VRAM at a time — load base → answer all prompts → load
 * fine-tuned → answer all prompts → zip the results.
 */

export type GenTarget = { modelId: string; adaptor?: string; label: string };

export type GenRow = { prompt: string; base: string; fineTuned: string };

export type GenProgress = {
  phase: "loading-base" | "base" | "loading-ft" | "fine-tuned";
  index: number; // current prompt (0-based) within the answering phase
  total: number;
};

async function loadModel(target: GenTarget): Promise<void> {
  const res = await fetch("/api/models/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelId: target.modelId, adaptor: target.adaptor }),
  });
  const data = (await res.json().catch(() => ({}))) as { loaded?: string; error?: string };
  if (!res.ok || !data.loaded) throw new Error(data.error || `Gagal memuat ${target.label}`);
}

async function complete(prompt: string, temperature: number, model: string): Promise<string> {
  const res = await fetch("/api/generations/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Ollama serves every pulled model, so name the one we're testing.
    body: JSON.stringify({ prompt, temperature, model }),
  });
  const data = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
  if (!res.ok) throw new Error(data.error || "Generation gagal");
  return data.reply ?? "";
}

export function useGenerations() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<GenProgress | null>(null);
  const [rows, setRows] = useState<GenRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Guard against state writes after unmount (the runner can take minutes).
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const answerAll = useCallback(
    async (
      prompts: string[],
      temperature: number,
      phase: "base" | "fine-tuned",
      model: string
    ): Promise<string[]> => {
      const answers: string[] = [];
      for (let i = 0; i < prompts.length; i++) {
        if (cancelledRef.current) break;
        setProgress({ phase, index: i, total: prompts.length });
        try {
          answers.push(await complete(prompts[i], temperature, model));
        } catch (err) {
          answers.push(`⚠️ ${(err as Error).message}`);
        }
      }
      return answers;
    },
    []
  );

  const runCompare = useCallback(
    async (p: {
      base: GenTarget;
      ft: GenTarget;
      prompts: string[];
      temperature: number;
    }) => {
      const prompts = p.prompts.map((s) => s.trim()).filter(Boolean);
      if (prompts.length === 0) {
        setError("Tulis minimal satu prompt.");
        return false;
      }
      setError(null);
      setRows([]);
      setRunning(true);
      try {
        setProgress({ phase: "loading-base", index: 0, total: prompts.length });
        await loadModel(p.base);
        const baseAnswers = await answerAll(prompts, p.temperature, "base", p.base.modelId);
        if (cancelledRef.current) return false;

        setProgress({ phase: "loading-ft", index: 0, total: prompts.length });
        await loadModel(p.ft);
        const ftAnswers = await answerAll(prompts, p.temperature, "fine-tuned", p.ft.modelId);
        if (cancelledRef.current) return false;

        setRows(
          prompts.map((prompt, i) => ({
            prompt,
            base: baseAnswers[i] ?? "",
            fineTuned: ftAnswers[i] ?? "",
          }))
        );
        return true;
      } catch (err) {
        if (!cancelledRef.current) setError((err as Error).message);
        return false;
      } finally {
        if (!cancelledRef.current) {
          setRunning(false);
          setProgress(null);
        }
      }
    },
    [answerAll]
  );

  return { running, progress, rows, error, runCompare };
}
