'use client';

import React from 'react';
import CashBankTabs from '../components/CashBankTabs';
import CashBankExceptions from '../components/CashBankExceptions';

export default function CashBankExceptionsPage() {
  return (
    <div className="p-6">
      <CashBankTabs />
      <CashBankExceptions />
    </div>
  );
}