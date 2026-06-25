export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  details: Record<string, unknown>;
  checkedAt: string;
}

export interface HealthCheckInput {
  database?: boolean;
  llm?: boolean;
  embedding?: boolean;
  fts?: boolean;
}

export type HealthCheckFunction = (options?: HealthCheckInput) => Promise<HealthStatus>;
