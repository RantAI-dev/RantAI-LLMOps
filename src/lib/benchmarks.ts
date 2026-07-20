/**
 * The benchmark catalogue — plain data, safe on both sides of the wire.
 *
 * Kept out of `lib/evals.ts` deliberately: that module reaches for the host
 * shell to merge adapters, so importing a value from it in a client component
 * drags `node:child_process` into the browser bundle and fails the build. Types
 * can cross that boundary (they are erased); `benchmarkById` cannot.
 */

export type Benchmark = {
  id: string;
  name: string;
  description: string;
  /**
   * Accuracy a model gets by guessing — 1/(number of options). Without it a
   * score cannot be read: 79% on a two-choice benchmark is far weaker than 79%
   * on a four-choice one, and nothing on screen would say so.
   */
  chance: number;
  /** Questions in the full benchmark, for sizing a run before starting it. */
  questions: number;
};

/** Small, well-known multiple-choice benchmarks that run quickly on a small GPU. */
export const BENCHMARKS: Benchmark[] = [
  { id: "arc_easy", name: "ARC Easy", description: "Soal sains tingkat SD.", chance: 0.25, questions: 2376 },
  { id: "arc_challenge", name: "ARC Challenge", description: "Sains yang lebih sulit.", chance: 0.25, questions: 1172 },
  { id: "hellaswag", name: "HellaSwag", description: "Nalar akal sehat — melanjutkan kalimat.", chance: 0.25, questions: 10042 },
  { id: "piqa", name: "PIQA", description: "Nalar fisik sehari-hari.", chance: 0.5, questions: 1838 },
  { id: "winogrande", name: "WinoGrande", description: "Menentukan acuan kata ganti.", chance: 0.5, questions: 1267 },
  { id: "boolq", name: "BoolQ", description: "Pemahaman bacaan ya/tidak.", chance: 0.5, questions: 3270 },
];

/** Benchmark metadata by id, for rendering a job that only knows the id. */
export function benchmarkById(id?: string): Benchmark | undefined {
  return id ? BENCHMARKS.find((b) => b.id === id) : undefined;
}
