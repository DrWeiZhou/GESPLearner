"use client";

/** Thin fetch wrapper: throws with the server's Chinese error message. */
export async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

const STORAGE_PREFIX = "gesp:code:";

/** Drafts survive reloads even for signed-out users. */
export function loadDraft(questionId: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_PREFIX + questionId);
}

export function saveDraft(questionId: string, code: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + questionId, code);
  } catch {
    // quota exceeded / private mode
  }
}
