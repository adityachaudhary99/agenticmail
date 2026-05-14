/** Predefined agent roles */
export type AgentRole = 'secretary' | 'assistant' | 'researcher' | 'writer' | 'custom';

export const AGENT_ROLES: readonly AgentRole[] = ['secretary', 'assistant', 'researcher', 'writer', 'custom'] as const;
export const DEFAULT_AGENT_ROLE: AgentRole = 'secretary';
export const DEFAULT_AGENT_NAME = 'secretary';

export interface Agent {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  stalwartPrincipal: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  role: AgentRole;
  /** Per-agent wake preference. When false, the dispatcher SKIPS
   *  this agent on every CC-only delivery regardless of the
   *  sender's `wake` list. Coder/silent-observer agents register
   *  with `wake_on_cc: false` so a designer's `cc:` accidentally
   *  including them never wastes a Claude turn. Defaults to true
   *  (preserves the 0.9.0 wake-list-respecting behaviour). */
  wakeOnCc?: boolean;
}

export interface CreateAgentOptions {
  name: string;
  domain?: string;
  password?: string;
  metadata?: Record<string, unknown>;
  gateway?: 'relay' | 'domain';
  role?: AgentRole;
}

export interface AgentRow {
  id: string;
  name: string;
  email: string;
  api_key: string;
  stalwart_principal: string;
  created_at: string;
  updated_at: string;
  metadata: string;
  role: string;
  wake_on_cc?: number;
}
