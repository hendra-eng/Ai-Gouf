'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BankCashPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/transactions/bank-cash/overview');
  }, [router]);

  return null;
}