import type { ReactNode } from 'react';

type CardProps = {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Card({ title, description, icon, actions, children, className = '' }: CardProps) {
  return (
    <section className={`panel panel-pad ${className}`.trim()}>
      {(title || description || icon || actions) && (
        <div className="section-header">
          <div className="section-header__main">
            {icon && <span className="icon-shell">{icon}</span>}
            <div>
              {title && <h2 className="section-header__title">{title}</h2>}
              {description && <p className="section-header__description">{description}</p>}
            </div>
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

