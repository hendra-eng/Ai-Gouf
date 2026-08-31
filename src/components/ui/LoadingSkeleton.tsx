import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return <div className={`animate-pulse bg-muted rounded-md ${className}`} style={style} />;
}

export function KPICardSkeleton() {
  return (
    <div className="card-elevated p-4 rounded-xl">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-32 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div className="card-elevated rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-32" />
      </div>
      <Skeleton className={`w-full rounded-lg`} style={{ height }} />
    </div>
  );
}

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="card-elevated rounded-xl overflow-hidden">
      <div className="p-4 border-b border-border">
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {Array.from({ length: cols }, (_, i) => (
                <th key={`skel-th-${i}`} className="px-4 py-3">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={`skel-row-${r}`} className="border-b border-border">
                {Array.from({ length: cols }, (_, c) => (
                  <td key={`skel-cell-${r}-${c}`} className="px-4 py-3">
                    <Skeleton className="h-4 w-full" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}