import { ArApWorkspacePage } from '@/components/arap/ArApWorkspace';

export const metadata = {
  title: 'Accounts Receivable — zafeb',
  description: 'Customer receivables from posted Sales invoices: aging, collections, statements and receipts.',
};

export default function AccountsReceivablePage() {
  return <ArApWorkspacePage side="ar" />;
}
