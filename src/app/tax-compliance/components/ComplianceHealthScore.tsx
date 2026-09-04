'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { useTaxComplianceData } from '../lib/taxBridge';

const ComplianceGaugeInner = dynamic(() => import('./ComplianceGaugeInner'), { ssr: false, loading: () => (
  <div className="h-48 animate-pulse bg-muted rounded-xl" />
) });

export default function ComplianceHealthScore() {
  const { health } = useTaxComplianceData();

  return (
    <div className="card-base p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Compliance Health</h3>
          <p className="text-2xs text-muted-foreground mt-0.5">Internal dashboard indicator only</p>
        </div>
        <span className="text-2xs text-muted-foreground px-2 py-1 rounded-full bg-muted border border-border">
          Not an official score
        </span>
      </div>

      <ComplianceGaugeInner score={health.overallScore} />

      <div className="mt-4 space-y-2.5 flex-1">
        {health.components?.map((c) => (
          <div key={`health-${c?.label}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground font-medium">{c?.label}</span>
              <span className={`text-xs font-semibold tabular-nums ${c?.score >= 90 ? 'text-positive' : c?.score >= 75 ? 'text-warning' : 'text-negative'}`}>
                {c?.score}%
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${c?.score >= 90 ? 'bg-positive' : c?.score >= 75 ? 'bg-warning' : 'bg-negative'}`}
                style={{ width: `${c?.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
