import React, { Suspense } from 'react';
import CoaFormPage from '../components/CoaFormPage';

export const metadata = {
  title: 'New Account — Chart of Accounts — FinovaAI',
};

export default function CoaNewPage() {
  return (
    <Suspense fallback={null}>
      <CoaFormPage mode="create" />
    </Suspense>
  );
}
