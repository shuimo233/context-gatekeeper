/**
 * After-Chain 工具链编排
 *
 * 核心理念：工具执行后可自动触发后续工具，形成链式调用。
 * 例如：memory_store → memory_extract（存储记忆后自动提取约束）
 */

/** 工具名称 */
export type ToolName =
  | 'memory_store'
  | 'memory_recall'
  | 'memory_anchor'
  | 'memory_report_usage'
  | 'context_compress'
  | 'project_create'
  | 'memory_store_batch'
  | 'memory_delete_batch'
  | 'memory_search'
  | 'configure_llm'
  | 'memory_stats'
  | 'memory_extract'
  | 'intelligent_recall'
  | 'dual_mode_execute'
  | 'gdpr_export'
  | 'gdpr_delete'
  | 'data_summary'
  | 'session_store'
  | 'session_store_batch'
  | 'session_delete';

/** After-Chain 触发器配置 */
export interface AfterChainHook {
  /** 触发工具名称 */
  triggerTool: ToolName;
  /** 后续工具名称 */
  followupTool: ToolName;
  /** 触发条件（可选），默认总是触发 */
  condition?: (input: unknown, output: unknown) => boolean;
  /** 是否异步执行（不阻塞主工具返回） */
  async?: boolean;
  /** 是否启用（可通过配置开关） */
  enabled?: boolean;
}

/** After-Chain 链配置 */
export interface ChainConfig {
  /** 链名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 钩子列表 */
  hooks: AfterChainHook[];
}

/** After-Chain 全局配置 */
export interface AfterChainGlobalConfig {
  /** 默认异步执行 */
  defaultAsync: boolean;
  /** 默认启用 */
  defaultEnabled: boolean;
  /** 全局开关 */
  enabled: boolean;
}

/** 默认 After-Chain 全局配置 */
export const DEFAULT_GLOBAL_CONFIG: AfterChainGlobalConfig = {
  defaultAsync: true,
  defaultEnabled: true,
  enabled: true,
};

/** 预定义的工具链 */
export const PREDEFINED_CHAINS: ChainConfig[] = [
  {
    name: 'store-then-extract',
    description: '存储记忆后自动提取约束（AutoSkill 风格）',
    hooks: [
      {
        triggerTool: 'memory_store',
        followupTool: 'memory_extract',
        async: true,
        enabled: true,
      },
    ],
  },
  {
    name: 'batch-store-then-extract',
    description: '批量存储后自动提取约束',
    hooks: [
      {
        triggerTool: 'memory_store_batch',
        followupTool: 'memory_extract',
        async: true,
        enabled: true,
      },
    ],
  },
  {
    name: 'session-store-then-extract',
    description: '会话存储后自动提取约束',
    hooks: [
      {
        triggerTool: 'session_store',
        followupTool: 'memory_extract',
        async: true,
        enabled: true,
      },
    ],
  },
];

/** After-Chain 事件 */
export interface AfterChainEvent {
  chain: string;
  triggerTool: ToolName;
  followupTool: ToolName;
  timestamp: string;
  input: unknown;
  output: unknown;
  success: boolean;
  error?: string;
}

/** After-Chain 回调函数类型 */
export type AfterChainCallback = (event: AfterChainEvent) => void;

/**
 * After-Chain 注册中心
 * 负责注册工具链、执行后钩子、管理全局配置
 */
export class AfterChainRegistry {
  private chains: Map<string, ChainConfig> = new Map();
  private globalConfig: AfterChainGlobalConfig = { ...DEFAULT_GLOBAL_CONFIG };
  private callbacks: AfterChainCallback[] = [];

  constructor() {
    // 注册预定义链
    for (const chain of PREDEFINED_CHAINS) {
      this.registerChain(chain);
    }
  }

  /** 注册一条工具链 */
  registerChain(config: ChainConfig): void {
    this.chains.set(config.name, config);
  }

  /** 注销一条工具链 */
  unregisterChain(name: string): void {
    this.chains.delete(name);
  }

  /** 更新全局配置 */
  updateGlobalConfig(updates: Partial<AfterChainGlobalConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...updates };
  }

  /** 获取全局配置 */
  getGlobalConfig(): AfterChainGlobalConfig {
    return { ...this.globalConfig };
  }

  /** 添加事件回调 */
  onEvent(callback: AfterChainCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index >= 0) this.callbacks.splice(index, 1);
    };
  }

  /** 获取所有已注册的链名称 */
  getChainNames(): string[] {
    return [...this.chains.keys()];
  }

  /** 获取链配置 */
  getChain(name: string): ChainConfig | undefined {
    return this.chains.get(name);
  }

  /** 获取所有链配置 */
  getAllChains(): ChainConfig[] {
    return [...this.chains.values()];
  }

  /** 切换链的启用状态 */
  toggleChain(name: string, enabled: boolean): boolean {
    const chain = this.chains.get(name);
    if (!chain) return false;
    chain.hooks = chain.hooks.map(hook => ({ ...hook, enabled }));
    return true;
  }

  /** 获取某工具触发的所有后续工具 */
  getFollowups(triggerTool: ToolName): AfterChainHook[] {
    const hooks: AfterChainHook[] = [];
    for (const chain of this.chains.values()) {
      for (const hook of chain.hooks) {
        if (hook.triggerTool === triggerTool && hook.enabled !== false) {
          hooks.push(hook);
        }
      }
    }
    return hooks;
  }

  /** 触发 After-Chain 回调 */
  emit(event: AfterChainEvent): void {
    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch {
        // 回调错误不影响主流程
      }
    }
  }

  /** 获取所有钩子的数量 */
  getHookCount(): number {
    let count = 0;
    for (const chain of this.chains.values()) {
      count += chain.hooks.filter(h => h.enabled !== false).length;
    }
    return count;
  }
}

// 全局单例
let registry: AfterChainRegistry | null = null;

export function getAfterChainRegistry(): AfterChainRegistry {
  if (!registry) {
    registry = new AfterChainRegistry();
  }
  return registry;
}

/** 重置注册中心（测试用） */
export function resetAfterChainRegistry(): void {
  registry = null;
}
