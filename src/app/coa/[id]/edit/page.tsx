import React, { Suspense } from 'react';
import CoaFormPage from '../../components/CoaFormPage';

export const metadata = {
  title: 'Edit Account — Chart of Accounts — FinovaAI',
};

export default function CoaEditPage() {
  return (
    <Suspense fallback={null}>
      <CoaFormPage mode="edit" />
    </Suspense>
  );
}
