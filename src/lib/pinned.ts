import { ChartSpec } from "./types";

export type PinnedInsight = {
  id: string;
  title: string;
  chartSpec: ChartSpec;
  createdAt: string;
};

const STORAGE_KEY = "financeos:pinned";

export function loadPinned(): PinnedInsight[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PinnedInsight[];
  } catch {
    return [];
  }
}

export function savePinned(items: PinnedInsight[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}
