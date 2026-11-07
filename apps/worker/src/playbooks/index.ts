import { solar } from './solar.ts';
import type { Playbook } from './types.ts';
import { water } from './water.ts';

export const PLAYBOOKS: Record<string, Playbook> = { water, solar };

/** Active playbook for new conversations. Existing conversations keep the one they started with. */
export const DEFAULT_PLAYBOOK = process.env.PLAYBOOK ?? 'water';

export function getPlaybook(id: string | undefined): Playbook {
  const p = PLAYBOOKS[id ?? DEFAULT_PLAYBOOK];
  if (!p) throw new Error(`Unknown playbook "${id}". Known: ${Object.keys(PLAYBOOKS).join(', ')}`);
  return p;
}
