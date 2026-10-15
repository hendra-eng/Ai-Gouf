import { ArApWorkspacePage } from '@/components/arap/ArApWorkspace';

export const metadata = {
  title: 'Accounts Payable — FinovaAI',
  description: 'Vendor payables from posted Purchase bills: aging, payments, statements and payment vouchers.',
};

export default function AccountsPayablePage() {
  return <ArApWorkspacePage side="ap" />;
}
