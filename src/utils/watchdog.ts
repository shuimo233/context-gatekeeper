/**
 * Watchdog 权限架构
 *
 * 核心设计：
 * - 工具分为 read（只读）和 write（读写）两类
 * - 主 agent 持只读 token，只能调用 read 工具
 * - 特殊 token 可绕过限制（如 watchdog agent）
 * - 权限检查在工具执行前进行
 */

import { logger } from './logger.js';

/** 工具权限级别 */
export type ToolPermission = 'read' | 'write';

/** 权限配置 */
export interface PermissionConfig {
  /** 工具名称 */
  tool: string;
  /** 权限级别 */
  permission: ToolPermission;
  /** 描述 */
  description?: string;
}

/** 所有工具的权限配置 */
export const TOOL_PERMISSIONS: PermissionConfig[] = [
  // 只读工具
  { tool: 'memory_recall', permission: 'read', description: '读取记忆' },
  { tool: 'memory_search', permission: 'read', description: '搜索记忆' },
  { tool: 'memory_stats', permission: 'read', description: '获取统计' },
  { tool: 'intelligent_recall', permission: 'read', description: '智能召回' },
  { tool: 'dual_mode_execute', permission: 'read', description: '双模式执行（仅软引导）' },
  { tool: 'data_summary', permission: 'read', description: '数据摘要（GDPR）' },
  { tool: 'memory_extract', permission: 'read', description: '约束提取（仅分析）' },

  // 读写工具
  { tool: 'memory_store', permission: 'write', description: '存储记忆' },
  { tool: 'memory_store_batch', permission: 'write', description: '批量存储' },
  { tool: 'memory_delete_batch', permission: 'write', description: '批量删除' },
  { tool: 'memory_anchor', permission: 'write', description: '锚定记忆' },
  { tool: 'context_compress', permission: 'write', description: '压缩上下文' },
  { tool: 'project_create', permission: 'write', description: '创建项目' },
  { tool: 'configure_llm', permission: 'write', description: '配置 LLM' },
  { tool: 'gdpr_export', permission: 'write', description: 'GDPR 导出' },
  { tool: 'gdpr_delete', permission: 'write', description: 'GDPR 删除' },
];

/** 只读工具列表 */
export const READ_ONLY_TOOLS = TOOL_PERMISSIONS.filter(p => p.permission === 'read').map(p => p.tool);

/** 读写工具列表 */
export const READ_WRITE_TOOLS = TOOL_PERMISSIONS.filter(p => p.permission === 'write').map(p => p.tool);

/** 权限验证结果 */
export interface PermissionCheckResult {
  allowed: boolean;
  tool: string;
  token: string;
  requiredPermission: ToolPermission;
  reason?: string;
}

/** Watchdog Token 管理器 */
export class WatchdogTokenManager {
  private readToken: string = '';
  private writeToken: string = '';
  private watchdogToken: string = '';

  constructor() {
    this.readToken = process.env.CG_READ_TOKEN || '';
    this.writeToken = process.env.CG_WRITE_TOKEN || '';
    this.watchdogToken = process.env.CG_WATCHDOG_TOKEN || '';
  }

  /** 设置 token */
  setToken(type: 'read' | 'write' | 'watchdog', token: string): void {
    switch (type) {
      case 'read':
        this.readToken = token;
        break;
      case 'write':
        this.writeToken = token;
        break;
      case 'watchdog':
        this.watchdogToken = token;
        break;
    }
  }

  /** 获取当前 token 类型 */
  getCurrentTokenType(token: string): 'read' | 'write' | 'watchdog' | 'unknown' {
    if (token === this.watchdogToken && this.watchdogToken) return 'watchdog';
    if (token === this.writeToken && this.writeToken) return 'write';
    if (token === this.readToken && this.readToken) return 'read';
    return 'unknown';
  }

  /** 检查工具调用权限 */
  checkPermission(tool: string, token: string): PermissionCheckResult {
    const start = performance.now();
    const toolConfig = TOOL_PERMISSIONS.find(p => p.tool === tool);

    if (!toolConfig) {
      logger.debug('Permission check: unknown tool', { tool, tokenType: this.getCurrentTokenType(token) });
      return {
        allowed: false,
        tool,
        token,
        requiredPermission: 'read',
        reason: `Unknown tool: ${tool}`,
      };
    }

    if (token === this.watchdogToken && this.watchdogToken) {
      const latencyMs = Math.round(performance.now() - start);
      logger.debug('Permission check: watchdog bypass', { tool, requiredPermission: toolConfig.permission, latencyMs });
      return {
        allowed: true,
        tool,
        token,
        requiredPermission: toolConfig.permission,
      };
    }

    const tokenType = this.getCurrentTokenType(token);

    if (tokenType === 'unknown' || !token) {
      if (toolConfig.permission === 'read') {
        const latencyMs = Math.round(performance.now() - start);
        logger.debug('Permission check: no token, read allowed', { tool, latencyMs });
        return {
          allowed: true,
          tool,
          token: token || '(none)',
          requiredPermission: toolConfig.permission,
        };
      }
      logger.debug('Permission check: no token, write denied', { tool, requiredPermission: toolConfig.permission });
      return {
        allowed: false,
        tool,
        token: token || '(none)',
        requiredPermission: toolConfig.permission,
        reason: `Tool '${tool}' requires write permission but no write token provided`,
      };
    }

    if (tokenType === 'read' && toolConfig.permission === 'write') {
      logger.debug('Permission check: read token cannot write', { tool, requiredPermission: toolConfig.permission });
      return {
        allowed: false,
        tool,
        token,
        requiredPermission: toolConfig.permission,
        reason: `Read-only token cannot execute write tool '${tool}'`,
      };
    }

    const latencyMs = Math.round(performance.now() - start);
    logger.debug('Permission check: allowed', { tool, tokenType, requiredPermission: toolConfig.permission, latencyMs });
    return {
      allowed: true,
      tool,
      token,
      requiredPermission: toolConfig.permission,
    };
  }

  /** 检查是否有任何 token 配置 */
  hasTokens(): boolean {
    return !!(this.readToken || this.writeToken || this.watchdogToken);
  }

  /** 生成随机 token */
  static generateToken(length = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// 全局单例
let _tokenManager: WatchdogTokenManager | null = null;

export function getWatchdogTokenManager(): WatchdogTokenManager {
  if (!_tokenManager) {
    _tokenManager = new WatchdogTokenManager();
  }
  return _tokenManager;
}

/** 便捷函数：检查工具权限 */
export function checkPermission(tool: string, token: string): PermissionCheckResult {
  return getWatchdogTokenManager().checkPermission(tool, token);
}

/** 重置 token 管理器（测试用） */
export function resetWatchdogTokenManager(): void {
  _tokenManager = null;
}
