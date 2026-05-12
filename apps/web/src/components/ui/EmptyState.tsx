import type { ReactNode } from 'react';

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {icon && <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 'var(--space-4)' }}>{icon}</div>}
      <h3 style={{ color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div style={{ marginTop: 'var(--space-5)' }}>{action}</div>}
    </div>
  );
}

