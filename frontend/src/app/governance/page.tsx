'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Bot, CheckCircle, PauseCircle, PlayCircle, Shield, XCircle } from 'lucide-react';
import { approvalsApi, governanceApi } from '@/lib/api';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';

type Tab = 'kill_switch' | 'approvals' | 'decisions';

export default function GovernancePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('kill_switch');
  const [selectedDecisionId, setSelectedDecisionId] = useState<string | null>(null);

  const killSwitchQuery = useQuery({
    queryKey: ['governance', 'killswitch'],
    queryFn: async () => (await governanceApi.killSwitchStatus()).data,
    refetchInterval: 2000,
  });

  const approvalsQuery = useQuery({
    queryKey: ['governance', 'approvals', 'pending'],
    queryFn: async () => (await approvalsApi.list({ status: 'pending', limit: 50 })).data,
    refetchInterval: 2000,
  });

  const decisionsQuery = useQuery({
    queryKey: ['governance', 'decisions'],
    queryFn: async () => (await governanceApi.decisions({ limit: 50 })).data,
    refetchInterval: 5000,
  });

  const decisionDetailQuery = useQuery({
    queryKey: ['governance', 'decision', selectedDecisionId],
    queryFn: async () => (await governanceApi.decision(selectedDecisionId!)).data,
    enabled: !!selectedDecisionId,
  });

  const pauseMutation = useMutation({
    mutationFn: ({ reason }: { reason?: string }) => governanceApi.pauseTenantAgents(undefined, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['governance', 'killswitch'] }),
  });

  const resumeMutation = useMutation({
    mutationFn: ({ reason }: { reason?: string }) => governanceApi.resumeTenantAgents(undefined, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['governance', 'killswitch'] }),
  });

  const globalStopMutation = useMutation({
    mutationFn: ({ reason }: { reason?: string }) => governanceApi.emergencyStop(undefined, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['governance', 'killswitch'] }),
  });

  const approvals = approvalsQuery.data?.data || [];
  const decisions = decisionsQuery.data?.data || [];

  const activeTenantPause = useMemo(() => {
    const status = killSwitchQuery.data;
    if (!status) return null;
    const entries = Object.entries(status.tenants || {});
    const paused = entries.find(([, s]) => s.state === 'paused' || s.state === 'killed');
    return paused ? { tenantId: paused[0], ...paused[1] } : null;
  }, [killSwitchQuery.data]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Governance</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Kill switch, approvals, and explainability artifacts
          </p>
        </div>
      </div>

      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        <TabButton tab="kill_switch" current={tab} onClick={() => setTab('kill_switch')}>
          <Shield size={16} className="mr-2" />
          Kill Switch
        </TabButton>
        <TabButton tab="approvals" current={tab} onClick={() => setTab('approvals')}>
          <Bot size={16} className="mr-2" />
          Approvals
        </TabButton>
        <TabButton tab="decisions" current={tab} onClick={() => setTab('decisions')}>
          <AlertTriangle size={16} className="mr-2" />
          Decisions
        </TabButton>
      </div>

      {tab === 'kill_switch' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">Current Status</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                Updates every 2s
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-secondary"
                onClick={() => killSwitchQuery.refetch()}
                disabled={killSwitchQuery.isFetching}
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatusCard title="Global" value={killSwitchQuery.data?.global?.state || 'running'} />
            <StatusCard title="Tenant Pause" value={activeTenantPause?.state || 'none'} />
            <StatusCard title="Tenant Count" value={String(Object.keys(killSwitchQuery.data?.tenants || {}).length)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-warning"
              onClick={() => pauseMutation.mutate({ reason: 'Paused via Governance UI' })}
              disabled={pauseMutation.isPending}
            >
              <PauseCircle size={16} className="mr-2" />
              Pause This Tenant
            </button>
            <button
              className="btn btn-primary"
              onClick={() => resumeMutation.mutate({ reason: 'Resumed via Governance UI' })}
              disabled={resumeMutation.isPending}
            >
              <PlayCircle size={16} className="mr-2" />
              Resume This Tenant
            </button>
            <button
              className="btn btn-danger"
              onClick={() => globalStopMutation.mutate({ reason: 'Emergency stop via Governance UI' })}
              disabled={globalStopMutation.isPending}
            >
              <XCircle size={16} className="mr-2" />
              Emergency Stop (Global)
            </button>
          </div>

          <div className="text-sm text-gray-500 dark:text-gray-400">
            Agents block actions on pause/kill within ≤1s via Redis pub/sub, and paused partitions are rewound to avoid message loss.
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-medium text-gray-900 dark:text-white">
              Pending approvals ({approvals.length})
            </div>
          </div>
          {approvals.length === 0 ? (
            <div className="text-gray-500">No pending approvals</div>
          ) : (
            <div className="space-y-3">
              {approvals.map((a) => (
                <div key={a.id} className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-white">{a.actionType}</div>
                      <div className="text-sm text-gray-500">
                        {a.requestorType} • created {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      {a.expiresAt ? `expires ${formatDistanceToNow(new Date(a.expiresAt), { addSuffix: true })}` : null}
                    </div>
                  </div>
                  {a.context?.reasoning && (
                    <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">{a.context.reasoning}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'decisions' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-6 space-y-3">
            <div className="font-medium text-gray-900 dark:text-white">Decision History</div>
            {decisions.length === 0 ? (
              <div className="text-gray-500">No decisions recorded</div>
            ) : (
              <div className="space-y-2">
                {decisions.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDecisionId(d.id)}
                    className={clsx(
                      'w-full text-left p-3 rounded-lg border transition-colors',
                      selectedDecisionId === d.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
                        : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-gray-900 dark:text-white truncate">{d.actionType}</div>
                        <div className="text-xs text-gray-500 truncate">{d.agentId}</div>
                      </div>
                      <div className="text-xs text-gray-500">{d.status}</div>
                    </div>
                    <div className="mt-2 text-xs text-gray-500">
                      {formatDistanceToNow(new Date(d.createdAt), { addSuffix: true })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card p-6 space-y-3">
            <div className="font-medium text-gray-900 dark:text-white">Explainability Viewer</div>
            {!selectedDecisionId ? (
              <div className="text-gray-500">Select a decision to view details</div>
            ) : decisionDetailQuery.isLoading ? (
              <div className="text-gray-500">Loading decision...</div>
            ) : decisionDetailQuery.data ? (
              <pre className="text-xs bg-gray-50 dark:bg-gray-900 p-4 rounded-lg overflow-auto max-h-[540px]">
{JSON.stringify(decisionDetailQuery.data, null, 2)}
              </pre>
            ) : (
              <div className="text-gray-500">Decision not found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  tab,
  current,
  onClick,
  children,
}: {
  tab: Tab;
  current: Tab;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'px-4 py-2 text-sm font-medium transition-colors flex items-center',
        current === tab
          ? 'bg-primary-600 text-white'
          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
      )}
    >
      {children}
    </button>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  const ok = value === 'running' || value === 'none';
  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700">
      <div className="text-sm text-gray-500">{title}</div>
      <div className="mt-2 flex items-center gap-2">
        {ok ? <CheckCircle size={16} className="text-green-500" /> : <AlertTriangle size={16} className="text-yellow-500" />}
        <div className="font-medium text-gray-900 dark:text-white">{value}</div>
      </div>
    </div>
  );
}

