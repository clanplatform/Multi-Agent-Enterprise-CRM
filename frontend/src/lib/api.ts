const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const API_PREFIX = '/api/v1';

class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

const normalizeEndpoint = (endpoint: string) => {
  if (endpoint.startsWith('http')) return endpoint;
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  if (path.startsWith('/api/')) return path;
  return `${API_PREFIX}${path}`;
};

const DEFAULT_TIMEOUT_MS = 10000;

// LLM-backed routes are proxied to the agents service and answered by Ollama.
// On a CPU-only deployment one generation takes 20-60s, so the 10s default
// aborted them client-side before the model replied -- the chat panel rendered
// "I couldn't complete that request" and the automation studio silently failed.
const LLM_TIMEOUT_MS = Number(process.env.NEXT_PUBLIC_LLM_TIMEOUT_MS) || 180000;
const LLM_PATHS = ['/intelligence', '/automations', '/audit/search', '/knowledge'];

const defaultTimeoutFor = (path: string): number =>
  LLM_PATHS.some((p) => path.includes(p)) ? LLM_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

type ReqOptions = RequestInit & { timeoutMs?: number };

class ApiClient {
  private async request<T>(endpoint: string, options?: ReqOptions): Promise<{ data: T }> {
    const normalized = normalizeEndpoint(endpoint);
    const url = `${BASE_URL}${normalized}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? defaultTimeoutFor(normalized));
    const token = typeof window !== 'undefined' ? window.localStorage.getItem('accessToken') : null;
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
      ...options?.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers,
      });

      if (!response.ok) {
        let message = `API Error: ${response.status} ${response.statusText}`;
        try {
          const body = await response.json();
          if (body?.error) message = body.error;
        } catch (_) {
          // ignore parse error
        }
        const err = new Error(message) as Error & { status?: number };
        err.status = response.status;
        throw err;
      }

      // Some endpoints might return empty body (e.g. 204)
      if (response.status === 204) {
          return { data: {} as T };
      }

      const data = await response.json();
      return { data };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new TimeoutError();
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  get<T>(endpoint: string, options?: ReqOptions): Promise<{ data: T }> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body: any, options?: ReqOptions): Promise<{ data: T }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put<T>(endpoint: string, body: any, options?: ReqOptions): Promise<{ data: T }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  patch<T>(endpoint: string, body: any, options?: ReqOptions): Promise<{ data: T }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  delete<T>(endpoint: string, options?: ReqOptions): Promise<{ data: T }> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }
}

export const api = new ApiClient();

// Interfaces
export interface Approval {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requestorType: string;
  actionType: string;
  expiresAt?: string;
  decidedAt?: string;
  decisionReason?: string;
  context?: {
    score?: number;
    confidence: number;
    amount?: number;
    reasoning?: string;
  };
}

export interface Ticket {
  id: string;
  [key: string]: any;
}

export interface Deal {
  id: string;
  [key: string]: any;
}

export interface Customer {
  id: string;
  [key: string]: any;
}

export interface Lead {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  source?: string;
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';
  score?: number;
  assignedUserId?: string;
  assignedUser?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface KillSwitchStatus {
  tenants?: Record<string, { state: string; [key: string]: any }>;
  [key: string]: any;
}

export interface ProductivityProposal {
  id: string;
  actionType: string;
  targetEntity: string;
  targetId: string;
  priority: 'low' | 'medium' | 'high' | string;
  justification: string;
  drafts?: any;
  status: 'pending' | 'approved' | 'rejected' | string;
  createdAt?: string;
  decidedAt?: string;
  decisionReason?: string;
  signalType?: string;
  signal?: any;
}

export interface Prediction {
  id: string;
  entityType: string;
  entityId: string;
  predictionType: string;
  probability: number;
  riskLevel: 'green' | 'yellow' | 'red' | string;
  explanation: string;
  createdAt?: string;
  modelVersion?: string;
  features?: any;
}

export interface AutomationPolicySummary {
  id: string;
  tenantId: string;
  createdBy: string;
  status: 'draft' | 'simulating' | 'active' | 'paused' | 'disabled' | string;
  nlRuleText: string;
  triggerType: string;
  version: number;
  lastSimulationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AutomationSimulation {
  id: string;
  policyId: string;
  createdAt: string;
  fromTs?: string | null;
  toTs?: string | null;
  result: any;
}

// Helper to create resource APIs
const createServiceApi = (prefix: string) => ({
  list: (params?: any) => {
    const searchParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
    }
    const queryString = searchParams.toString();
    return api.get<any>(`${prefix}${queryString ? '?' + queryString : ''}`);
  },
  get: (id: string) => api.get<any>(`${prefix}/${id}`),
  create: (data: any) => api.post<any>(`${prefix}`, data),
  update: (id: string, data: any) => api.patch<any>(`${prefix}/${id}`, data),
  delete: (id: string) => api.delete<any>(`${prefix}/${id}`),
});

// Export specific APIs
export const approvalsApi = {
  ...createServiceApi('/api/v1/approvals'),
  decide: (id: string, decision: 'approved' | 'rejected', reason?: string) => 
    api.post<any>(`/api/v1/approvals/${id}/decide`, { decision, reason }), 
};

export const productivityApi = {
  listProposals: (params?: { status?: 'pending' | 'approved' | 'rejected'; priority?: 'low' | 'medium' | 'high'; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.priority) searchParams.append('priority', params.priority);
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const qs = searchParams.toString();
    return api.get<{ data: ProductivityProposal[] }>(`/api/v1/productivity/proposals${qs ? '?' + qs : ''}`);
  },
  decide: (id: string, decision: 'approved' | 'rejected', reason?: string) =>
    api.post<ProductivityProposal>(`/api/v1/productivity/proposals/${id}/decide`, { decision, reason }),
};

export const automationsApi = {
  list: (params?: { status?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.page) searchParams.append('page', String(params.page));
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const qs = searchParams.toString();
    return api.get<{ data: AutomationPolicySummary[]; pagination: any }>(`/api/v1/automations${qs ? '?' + qs : ''}`);
  },
  get: (id: string) => api.get<any>(`/api/v1/automations/${id}`),
  parse: (nlRuleText: string) => api.post<any>('/api/v1/automations/parse', { nlRuleText }),
  create: (nlRuleText: string) => api.post<any>('/api/v1/automations', { nlRuleText }),
  update: (id: string, nlRuleText: string) => api.put<any>(`/api/v1/automations/${id}`, { nlRuleText }),
  simulate: (id: string, params?: { fromTs?: string; toTs?: string }) => api.post<any>(`/api/v1/automations/${id}/simulate`, params || {}),
  simulations: (id: string, params?: { limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const qs = searchParams.toString();
    return api.get<{ data: AutomationSimulation[] }>(`/api/v1/automations/${id}/simulations${qs ? '?' + qs : ''}`);
  },
  requestActivation: (id: string) => api.post<any>(`/api/v1/automations/${id}/request-activation`, {}),
  pause: (id: string) => api.post<any>(`/api/v1/automations/${id}/pause`, {}),
  resume: (id: string) => api.post<any>(`/api/v1/automations/${id}/resume`, {}),
  deactivate: (id: string) => api.post<any>(`/api/v1/automations/${id}/deactivate`, {}),
};

export const customersApi = {
  ...createServiceApi('/api/v1/customers'),
  timeline: (id: string, params?: { limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const qs = searchParams.toString();
    return api.get<{ data: any[] }>(`/api/v1/customers/${id}/timeline${qs ? '?' + qs : ''}`);
  },
  profile: (id: string) => api.get<any>(`/api/v1/customers/${id}/profile`),
};

export const predictionsApi = {
  latest: (entityType: string, entityIds: string[]) => {
    const ids = entityIds.filter(Boolean).slice(0, 200).join(',');
    return api.get<{ entityType: string; data: Record<string, Record<string, Prediction>> }>(
      `/api/v1/predictions/latest?entityType=${encodeURIComponent(entityType)}&entityIds=${encodeURIComponent(ids)}`
    );
  },
};

export const dealsApi = {
  ...createServiceApi('/api/v1/deals'),
  updateStage: (id: string, stage: string) => api.put<any>(`/api/v1/deals/${id}/stage`, { stage }),
};

export const governanceApi = {
  ...createServiceApi('/api/v1/governance'),
  killSwitchStatus: () => api.get<KillSwitchStatus>('/api/v1/governance/killswitch/status'),
  decisions: (params?: any) => {
    // Re-implement generic list logic or reuse if accessible? 
    // Just use api.get with params logic or simplified
    const searchParams = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => v && searchParams.append(k, String(v)));
    return api.get<any>(`/api/v1/governance/decisions?${searchParams.toString()}`);
  },
  decision: (id: string) => api.get<any>(`/api/v1/governance/decisions/${id}`),
  pauseTenantAgents: (tenantId?: string, reason?: string) => api.post<any>('/api/v1/governance/killswitch/pause', { tenantId, reason }),
  resumeTenantAgents: (tenantId?: string, reason?: string) => api.post<any>('/api/v1/governance/killswitch/resume', { tenantId, reason }),
  emergencyStop: (agentId?: string, reason?: string) => api.post<any>('/api/v1/governance/killswitch/emergency-stop', { agentId, reason }),
};

export const auditApi = {
  search: (data: {
    query: string;
    fromTs?: string;
    toTs?: string;
    agentName?: string;
    actionType?: string;
    status?: string;
    riskLevel?: string;
    limit?: number;
  }) => api.post<any>('/api/v1/audit/search', data),
  policies: () => api.get<any>('/api/v1/audit/policies?format=summary'),
};

export const knowledgeApi = {
  listDrafts: (params?: { status?: 'draft' | 'approved' | 'rejected'; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append('status', params.status);
    if (params?.page) searchParams.append('page', String(params.page));
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const qs = searchParams.toString();
    return api.get<any>(`/api/v1/knowledge/drafts${qs ? `?${qs}` : ''}`);
  },
  getDraft: (id: string) => api.get<any>(`/api/v1/knowledge/drafts/${id}`),
  updateDraft: (id: string, data: any) => api.put<any>(`/api/v1/knowledge/drafts/${id}`, data),
  approveDraft: (id: string) => api.post<any>(`/api/v1/knowledge/drafts/${id}/approve`, {}),
  rejectDraft: (id: string, reason?: string) => api.post<any>(`/api/v1/knowledge/drafts/${id}/reject`, { reason }),
  listArticles: (params?: { tag?: string; page?: number; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.tag) searchParams.append('tag', params.tag);
    if (params?.page) searchParams.append('page', String(params.page));
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const qs = searchParams.toString();
    return api.get<any>(`/api/v1/knowledge/articles${qs ? `?${qs}` : ''}`);
  },
  getArticle: (id: string) => api.get<any>(`/api/v1/knowledge/articles/${id}`),
};

export const leadsApi = createServiceApi('/api/v1/leads');

export const ticketsApi = {
  ...createServiceApi('/api/v1/tickets'),
  resolve: (id: string, resolution: any) => api.post<any>(`/api/v1/tickets/${id}/resolve`, { resolution }),
};

export const replayApi = {
  ...createServiceApi('/api/v1/replay'),
  start: (data: any) => api.post<any>('/api/v1/replay/jobs', data),
  status: (jobId: string) => api.get<any>(`/api/v1/replay/jobs/${jobId}`),
  timeline: (aggregateType: string, aggregateId: string, tenantId: string) => 
    api.get<any>(`/api/v1/replay/timeline?aggregateType=${aggregateType}&aggregateId=${aggregateId}&tenantId=${tenantId}`),
  diff: (jobId: string, fromVersion: number, toVersion: number) => 
    api.get<any>(`/api/v1/replay/jobs/${jobId}/diff?from=${fromVersion}&to=${toVersion}`),
};
