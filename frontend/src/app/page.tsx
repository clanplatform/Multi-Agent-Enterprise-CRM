import { 
  Users, 
  Briefcase, 
  Ticket, 
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Bot,
  Clock
} from 'lucide-react';

const stats = [
  {
    name: 'Total Leads',
    value: '2,847',
    change: '+12.5%',
    trend: 'up',
    icon: Users,
    color: 'bg-blue-500',
  },
  {
    name: 'Active Deals',
    value: '156',
    change: '+8.2%',
    trend: 'up',
    icon: Briefcase,
    color: 'bg-green-500',
  },
  {
    name: 'Open Tickets',
    value: '43',
    change: '-5.4%',
    trend: 'down',
    icon: Ticket,
    color: 'bg-yellow-500',
  },
  {
    name: 'Revenue MTD',
    value: '$124,500',
    change: '+23.1%',
    trend: 'up',
    icon: TrendingUp,
    color: 'bg-purple-500',
  },
];

const recentActivity = [
  {
    id: 1,
    type: 'lead',
    action: 'Lead qualified by AI',
    subject: 'John Smith - Acme Corp',
    time: '2 minutes ago',
    agent: 'Sales Agent',
  },
  {
    id: 2,
    type: 'deal',
    action: 'Stage changed',
    subject: 'Enterprise License Deal',
    time: '15 minutes ago',
    agent: null,
  },
  {
    id: 3,
    type: 'ticket',
    action: 'Ticket triaged by AI',
    subject: 'Integration Issue #1234',
    time: '1 hour ago',
    agent: 'Support Agent',
  },
  {
    id: 4,
    type: 'approval',
    action: 'Approval required',
    subject: 'High-value deal close',
    time: '2 hours ago',
    agent: 'Sales Agent',
  },
];

const pendingApprovals = [
  {
    id: 1,
    type: 'Deal Close',
    amount: '$75,000',
    requestedBy: 'Sales Agent',
    urgency: 'high',
  },
  {
    id: 2,
    type: 'Lead Qualification',
    amount: null,
    requestedBy: 'Sales Agent',
    urgency: 'medium',
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Dashboard
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          Overview of your CRM performance
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.name} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {stat.name}
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                    {stat.value}
                  </p>
                </div>
                <div className={`p-3 rounded-lg ${stat.color}`}>
                  <Icon size={24} className="text-white" />
                </div>
              </div>
              <div className="flex items-center mt-4">
                {stat.trend === 'up' ? (
                  <ArrowUp size={16} className="text-green-500" />
                ) : (
                  <ArrowDown size={16} className="text-red-500" />
                )}
                <span
                  className={`text-sm ml-1 ${
                    stat.trend === 'up' ? 'text-green-500' : 'text-red-500'
                  }`}
                >
                  {stat.change}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                  vs last month
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent activity */}
        <div className="lg:col-span-2 card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Recent Activity
          </h2>
          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <div className="flex-shrink-0">
                  {activity.agent ? (
                    <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center">
                      <Bot size={20} className="text-primary-600" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                      <Clock size={20} className="text-gray-500" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {activity.action}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {activity.subject}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {activity.time}
                  </p>
                  {activity.agent && (
                    <span className="badge badge-info mt-1">
                      {activity.agent}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pending approvals */}
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Pending Approvals
          </h2>
          <div className="space-y-3">
            {pendingApprovals.map((approval) => (
              <div
                key={approval.id}
                className="p-3 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {approval.type}
                  </span>
                  <span
                    className={`badge ${
                      approval.urgency === 'high'
                        ? 'badge-danger'
                        : 'badge-warning'
                    }`}
                  >
                    {approval.urgency}
                  </span>
                </div>
                {approval.amount && (
                  <p className="text-lg font-bold text-primary-600 mt-1">
                    {approval.amount}
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Requested by {approval.requestedBy}
                </p>
                <div className="flex gap-2 mt-3">
                  <button className="btn btn-primary flex-1 text-xs py-1">
                    Approve
                  </button>
                  <button className="btn btn-secondary flex-1 text-xs py-1">
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost w-full mt-4 text-sm">
            View All Approvals
          </button>
        </div>
      </div>
    </div>
  );
}
