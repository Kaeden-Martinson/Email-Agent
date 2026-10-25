// Which local model fits this PC. Pure, so it's tested: bigger models are smarter but need more memory.

export interface ModelChoice {
  model: string;
  /** Download size, for the UI. */
  sizeGB: number;
  /** Shown when the PC is on the small side. */
  note?: string;
}

export const MODEL_CHOICES = {
  large: { model: 'qwen2.5:7b', sizeGB: 4.7 },
  medium: { model: 'qwen2.5:3b', sizeGB: 1.9 },
  small: { model: 'qwen2.5:1.5b', sizeGB: 1.0 },
} as const;

/**
 * A graphics card with 6 GB+ or 16 GB+ of RAM runs the 7B model well; 8 GB+ RAM gets the 3B model;
 * below that, the 1.5B model (summaries are simpler and drafts weaker).
 */
export function recommendModel(ramGB: number, vramGB?: number): ModelChoice {
  if ((vramGB ?? 0) >= 6 || ramGB >= 15.5) return { ...MODEL_CHOICES.large };
  if (ramGB >= 7.5) return { ...MODEL_CHOICES.medium, note: 'This PC has 8–16 GB of memory, so Pilot uses a smaller model. It works well, just a little less sharp.' };
  return { ...MODEL_CHOICES.small, note: 'This PC has under 8 GB of memory, so Pilot uses its smallest model. Summaries will be simpler and slower.' };
}

/** The installed model to use: the recommended one if present, else the best installed chat model. */
export function installedChoice(installed: readonly string[], recommended: string): string | undefined {
  const has = (m: string) => installed.some((x) => x === m || x === `${m}:latest`);
  if (has(recommended)) return recommended;
  return [MODEL_CHOICES.large.model, MODEL_CHOICES.medium.model, MODEL_CHOICES.small.model].find(has);
}
