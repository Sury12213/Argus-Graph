import type { ReactNode } from 'react';

type BadgeProps = {
  tone?: 'neutral' | 'info' | 'primary' | 'success' | 'warning' | 'danger' | 'critical';
  children: ReactNode;
  className?: string;
};

const toneClass = {
  neutral: 'badge-neutral',
  info: 'badge-info',
  primary: 'badge-primary',
  success: 'badge-safe',
  warning: 'badge-warning',
  danger: 'badge-danger',
  critical: 'badge-critical',
};

export function Badge({ tone = 'neutral', children, className = '' }: BadgeProps) {
  return <span className={`badge ${toneClass[tone]} ${className}`.trim()}>{children}</span>;
}

