import { Suspense } from 'react';
import AIAnalystLayout from './components/AIAnalystLayout';

export default function AIFinancialAnalystPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-gray-500">Loading AI Financial Analyst...</div></div>}>
      <AIAnalystLayout />
    </Suspense>
  );
}