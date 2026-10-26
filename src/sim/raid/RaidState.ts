import type { ResourceKind } from '../../data/resources';

export type RaidPhase = 'incoming' | 'active';

export interface RaidState {
  readonly id: string;
  readonly baseId: string;
  readonly baseName: string;
  phase: RaidPhase;
  /** Countdown to the strike while incoming, time left while active. */
  secondsRemaining: number;
  readonly attackers: number;
  /** Enemy ids spawned for a live raid. */
  attackerIds: string[];
  looted: number;
  damagedStructures: number;
}

export type RaidOutcome = 'repelled' | 'looted' | 'captured';

export interface RaidReport {
  readonly id: string;
  readonly baseName: string;
  readonly tick: number;
  readonly live: boolean;
  readonly outcome: RaidOutcome;
  readonly looted: number;
  readonly structuresLost: number;
}

/** How many raid reports are kept for the HUD log. */
export const MAX_RAID_REPORTS = 5;

export type RaidLoot = Partial<Record<ResourceKind, number>>;
