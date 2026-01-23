'use client';

import { Badge } from '@/components/ui/badge';

interface SyncStatusBadgeProps {
  status: string;
  lastSyncAt?: string | null;
}

export function SyncStatusBadge({ status, lastSyncAt }: SyncStatusBadgeProps) {
  const getStatusDisplay = () => {
    switch (status) {
      case 'connected':
        return {
          tone: 'positive' as const,
          label: lastSyncAt ? `Synced ${formatTimeAgo(lastSyncAt)}` : 'Connected',
        };
      case 'needs_reauth':
        return {
          tone: 'warning' as const,
          label: 'Reconnect Required',
        };
      case 'never':
        return {
          tone: 'default' as const,
          label: 'Never Synced',
        };
      default:
        return {
          tone: 'default' as const,
          label: 'Not Connected',
        };
    }
  };

  const { tone, label } = getStatusDisplay();

  return <Badge tone={tone}>{label}</Badge>;
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
