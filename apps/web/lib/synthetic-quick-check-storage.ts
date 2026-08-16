import type { SyntheticQuickCheckResult } from "@gapproof/contracts";

export type StoredSyntheticQuickCheck = {
  studentId: string;
  finding: SyntheticQuickCheckResult["finding"];
  correctCount: number;
  totalCount: number;
  completedAt: string;
};

const findingValues: readonly SyntheticQuickCheckResult["finding"][] = [
  "irregular_participle",
  "past_tense",
  "passive_voice",
  "mixed_review",
];

export function syntheticQuickCheckStorageKey(studentId: string) {
  return `gapproof:synthetic-quick-check:${studentId}`;
}

function isStoredResult(value: unknown, studentId: string): value is StoredSyntheticQuickCheck {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredSyntheticQuickCheck>;
  return candidate.studentId === studentId
    && typeof candidate.finding === "string"
    && findingValues.includes(candidate.finding as SyntheticQuickCheckResult["finding"])
    && typeof candidate.correctCount === "number"
    && Number.isFinite(candidate.correctCount)
    && typeof candidate.totalCount === "number"
    && Number.isFinite(candidate.totalCount)
    && typeof candidate.completedAt === "string"
    && candidate.completedAt.length > 0;
}

export function saveSyntheticQuickCheckResult(studentId: string, result: SyntheticQuickCheckResult): StoredSyntheticQuickCheck {
  const stored: StoredSyntheticQuickCheck = {
    studentId,
    finding: result.finding,
    correctCount: result.correctCount,
    totalCount: result.totalCount,
    completedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(syntheticQuickCheckStorageKey(studentId), JSON.stringify(stored));
    } catch {
      // The in-memory result remains available when storage is unavailable.
    }
  }
  return stored;
}

export function readSyntheticQuickCheckResult(studentId: string): StoredSyntheticQuickCheck | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(syntheticQuickCheckStorageKey(studentId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredResult(parsed, studentId) ? parsed : null;
  } catch {
    return null;
  }
}
