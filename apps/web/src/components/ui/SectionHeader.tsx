import type { ReactNode } from 'react';

type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export function SectionHeader({ eyebrow, title, description, icon, action }: SectionHeaderProps) {
  return (
    <div className="section-header">
      <div className="section-header__main">
        {icon && <span className="icon-shell">{icon}</span>}
        <div>
          {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
          <h2 className="section-header__title">{title}</h2>
          {description && <p className="section-header__description">{description}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

