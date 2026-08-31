import React from 'react';
import Icon from '@/components/ui/AppIcon';

interface BalanceValidationCardProps {
  assets: string;
  liabilities: string;
  equity: string;
  difference: string;
  balanced: boolean;
}

export default function BalanceValidationCard({ assets, liabilities, equity, difference, balanced }: BalanceValidationCardProps) {
  return (
    <div className={`fin-card p-4 rounded-lg border-l-4 ${balanced ? 'border-l-green-500' : 'border-l-red-500'}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon
          name={balanced ? 'CheckCircleIcon' : 'ExclamationCircleIcon'}
          size={16}
          className={balanced ? 'text-positive' : 'text-negative'}
        />
        <span className="text-[13px] font-600 text-foreground">Balance Sheet Validation</span>
        <span className={`fin-badge text-[10px] px-2 py-0.5 border ${balanced ? 'bg-green-50 text-green-700 border-green-200' : 'bg-negative-subtle text-negative border-red-200'}`}>
          {balanced ? 'Balanced' : 'Unbalanced'}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] text-muted-foreground mb-0.5">Assets</div>
          <div className="text-[13px] font-600 text-foreground financial-value">{assets}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-0.5">Liabilities</div>
          <div className="text-[13px] font-600 text-foreground financial-value">{liabilities}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground mb-0.5">Equity</div>
          <div className="text-[13px] font-600 text-foreground financial-value">{equity}</div>
        </div>
      </div>
      <div className={`mt-3 pt-3 border-t border-border text-center text-[11px] font-500 ${balanced ? 'text-positive' : 'text-negative'}`}>
        Difference: {difference}
      </div>
    </div>
  );
}
