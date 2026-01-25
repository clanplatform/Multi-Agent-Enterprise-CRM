const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class ApiClient {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<{ data: T }> {
    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    // Some endpoints might return empty body (e.g. 204)
    if (response.status === 204) {
        return { data: {} as T };
    }

    const data = await response.json();
    return { data };
  }

  get<T>(endpoint: string, options?: RequestInit): Promise<{ data: T }> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  post<T>(endpoint: string, body: any, options?: RequestInit): Promise<{ data: T }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put<T>(endpoint: string, body: any, options?: RequestInit): Promise<{ data: T }> {
    return this.request<T>(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  delete<T>(endpoint: string, options?: RequestInit): Promise<{ data: T }> {
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
  [key: string]: any;
}

export interface KillSwitchStatus {
  tenants?: Record<string, { state: string; [key: string]: any }>;
  [key: string]: any;
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
  update: (id: string, data: any) => api.put<any>(`${prefix}/${id}`, data),
  delete: (id: string) => api.delete<any>(`${prefix}/${id}`),
});

// Export specific APIs
export const approvalsApi = {
  ...createServiceApi('/approvals'),
  decide: (id: string, decision: 'approved' | 'rejected', reason?: string) => 
    api.post<any>(`/approvals/${id}/decide`, { decision, reason }), 
};

export const customersApi = createServiceApi('/customers');

export const dealsApi = {
  ...createServiceApi('/deals'),
  updateStage: (id: string, stage: string) => api.put<any>(`/deals/${id}/stage`, { stage }),
};

export const governanceApi = {
  ...createServiceApi('/governance'),
  killSwitchStatus: () => api.get<KillSwitchStatus>('/governance/kill-switch'),
  decisions: (params?: any) => {
    // Re-implement generic list logic or reuse if accessible? 
    // Just use api.get with params logic or simplified
    const searchParams = new URLSearchParams();
    if (params) Object.entries(params).forEach(([k, v]) => v && searchParams.append(k, String(v)));
    return api.get<any>(`/governance/decisions?${searchParams.toString()}`);
  },
  decision: (id: string) => api.get<any>(`/governance/decisions/${id}`),
  pauseTenantAgents: (tenantId?: string, reason?: string) => api.post<any>('/governance/pause', { tenantId, reason }),
  resumeTenantAgents: (tenantId?: string, reason?: string) => api.post<any>('/governance/resume', { tenantId, reason }),
  emergencyStop: (tenantId?: string, reason?: string) => api.post<any>('/governance/emergency-stop', { tenantId, reason }),
};

export const leadsApi = createServiceApi('/leads');

export const ticketsApi = {
  ...createServiceApi('/tickets'),
  resolve: (id: string, resolution: any) => api.post<any>(`/tickets/${id}/resolve`, { resolution }),
};

export const replayApi = {
  ...createServiceApi('/replay'),
  start: (data: any) => api.post<any>('/replay/jobs', data),
  status: (jobId: string) => api.get<any>(`/replay/jobs/${jobId}`),
  timeline: (aggregateType: string, aggregateId: string, tenantId: string) => 
    api.get<any>(`/replay/timeline?aggregateType=${aggregateType}&aggregateId=${aggregateId}&tenantId=${tenantId}`),
  diff: (jobId: string, fromVersion: number, toVersion: number) => 
    api.get<any>(`/replay/jobs/${jobId}/diff?from=${fromVersion}&to=${toVersion}`),
};
