import { MemoryResponse } from '../../models/types.js';

/**
 * Default threshold for triggering compression (40-50% context usage)
 */
export const DEFAULT_THRESHOLD_LOW = 0.4;
export const DEFAULT_THRESHOLD_HIGH = 0.5;

/**
 * Threshold detector for context usage
 */
export class ThresholdDetector {
  private thresholdLow: number;
  private thresholdHigh: number;
  
  constructor(thresholdLow: number = DEFAULT_THRESHOLD_LOW, 
              thresholdHigh: number = DEFAULT_THRESHOLD_HIGH) {
    this.thresholdLow = thresholdLow;
    this.thresholdHigh = thresholdHigh;
  }
  
  /**
   * Report current token usage from the agent
   */
  reportUsage(usedTokens: number, maxTokens: number): MemoryResponse {
    const ratio = usedTokens / maxTokens;
    
    return {
      shouldCompress: this.shouldCompress(ratio),
      currentRatio: ratio
    };
  }
  
  /**
   * Check if compression should be triggered
   */
  shouldCompress(ratio: number): boolean {
    return ratio >= this.thresholdLow && ratio <= this.thresholdHigh;
  }
  
  /**
   * Get current threshold settings
   */
  getThresholds(): { low: number; high: number } {
    return {
      low: this.thresholdLow,
      high: this.thresholdHigh
    };
  }
  
  /**
   * Update threshold settings
   */
  setThresholds(low: number, high: number): void {
    if (low < 0 || low > 1 || high < 0 || high > 1 || low > high) {
      throw new Error('Invalid threshold values');
    }
    this.thresholdLow = low;
    this.thresholdHigh = high;
  }
}

// Singleton instance
let thresholdDetectorInstance: ThresholdDetector | null = null;

export function getThresholdDetector(): ThresholdDetector {
  if (!thresholdDetectorInstance) {
    thresholdDetectorInstance = new ThresholdDetector();
  }
  return thresholdDetectorInstance;
}
