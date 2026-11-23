import { forwardRef } from 'react';

interface LoadingSpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  color?: 'primary' | 'secondary' | 'white';
  className?: string;
}

export const LoadingSpinner = forwardRef<HTMLDivElement, LoadingSpinnerProps>(
  ({ size = 'md', color = 'primary', className = '', ...props }, ref) => {
    const sizeClasses = {
      sm: 'w-4 h-4 border-2',
      md: 'w-6 h-6 border-2',
      lg: 'w-8 h-8 border-3',
      xl: 'w-12 h-12 border-4',
    };

    const colorClasses = {
      primary: 'border-primary-500 border-t-transparent',
      secondary: 'border-secondary-500 border-t-transparent',
      white: 'border-white border-t-transparent',
    };

    return (
      <div
        ref={ref}
        className={`${sizeClasses[size]} ${colorClasses[color]} rounded-full animate-spin ${className}`}
        role="status"
        aria-label="Loading"
        {...props}
      >
        <span className="sr-only">Loading...</span>
      </div>
    );
  }
);

LoadingSpinner.displayName = 'LoadingSpinner';

export const LoadingOverlay = ({ isLoading, children }: { isLoading: boolean; children: React.ReactNode }) => (
  <div className="relative">
    {children}
    {isLoading && (
      <div className="absolute inset-0 bg-white/80 dark:bg-secondary-950/80 flex items-center justify-center z-10 rounded-xl">
        <LoadingSpinner size="lg" />
      </div>
    )}
  </div>
);

export const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center">
    <LoadingSpinner size="xl" />
  </div>
);