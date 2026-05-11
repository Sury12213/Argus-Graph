import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
};

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, ...props }: ButtonProps) {
  const sizeClass = size === 'lg' ? 'btn-lg' : size === 'sm' ? '' : '';
  return (
    <button className={`btn btn-${variant} ${sizeClass} ${className}`.trim()} {...props}>
      {icon}
      {children}
    </button>
  );
}

