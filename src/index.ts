import { runServer } from './mcp/server.js';
import { logger } from './utils/logger.js';

runServer().catch((error) => {
  logger.error('Server crashed', { error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined });
  process.exit(1);
});
