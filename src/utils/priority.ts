import { Priority, PRIORITY_WEIGHTS, ANCHORED_DECAY_FACTOR, DEFAULT_DECAY_FACTOR } from '../models/types.js';

/**
 * Calculate the decay factor based on memory age
 */
export function calculateTimeDecay(createdAt: Date, anchored: boolean): number {
  if (anchored) {
    return ANCHORED_DECAY_FACTOR;
  }
  
  const now = Date.now();
  const ageInDays = (now - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  
  // Simple exponential decay: decay_factor^age
  return Math.pow(DEFAULT_DECAY_FACTOR, ageInDays);
}

/**
 * Calculate the priority score for a memory
 * 
 * Formula: score = priority_weight * (1 + access_count * 0.1) * time_decay
 * 
 * - Anchored memories: weight = 1.0, decay = 1.0 (permanent)
 * - Constraint: weight = 0.8
 * - Decision: weight = 0.6
 * - Preference: weight = 0.4
 * - Fact: weight = 0.2
 */
export function calculatePriorityScore(
  priority: Priority,
  accessCount: number,
  createdAt: Date,
  anchored: boolean
): number {
  const weight = PRIORITY_WEIGHTS[priority];
  const decay = calculateTimeDecay(createdAt, anchored);
  const accessBonus = 1 + accessCount * 0.1;
  
  return weight * accessBonus * decay;
}

/**
 * Get priority weight value
 */
export function getPriorityWeight(priority: Priority): number {
  return PRIORITY_WEIGHTS[priority];
}

/**
 * Check if a priority level is high enough for quick matching
 */
export function isHighPriority(priority: Priority): boolean {
  return priority === 'anchored' || priority === 'constraint';
}
