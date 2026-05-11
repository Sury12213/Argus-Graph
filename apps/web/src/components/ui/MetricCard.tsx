import type { ReactNode } from 'react';

type MetricCardProps = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  helperText?: ReactNode;
  className?: string;
};

export function MetricCard({ label, value, icon, helperText, className = '' }: MetricCardProps) {
  return (
    <div className={`metric-card ${className}`.trim()}>
      <div className="metric-card__top">
        <div className="metric-card__label">{label}</div>
        {icon && <span className="icon-shell">{icon}</span>}
      </div>
      <div className="metric-card__value">{value}</div>
      {helperText && <div className="metric-card__helper">{helperText}</div>}
    </div>
  );
}

