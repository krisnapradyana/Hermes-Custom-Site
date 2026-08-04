"use client";

import { ModelChoice } from "./model-choices";
import { api } from "./api";

/**
 * The user's chosen model, shared app-wide and remembered across sessions.
 * hermesStream() reads it at request time, so the choice applies to every
 * send path without threading a parameter through each one.
 */

const KEY = "hermes-model";

let cachedChoices: ModelChoice[] | null = null;

export async function fetchModelChoices(): Promise<ModelChoice[]> {
  if (cachedChoices) return cachedChoices;
  const res = await api.get<{ models: ModelChoice[] }>("/api/models");
  cachedChoices = res.ok ? res.data.models : [];
  return cachedChoices;
}

/** Selected model id, or null → server default (HERMES_MODEL). */
export function getSelectedModel(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setSelectedModel(id: string | null): void {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {}
}
