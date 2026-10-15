import ExportPreview from '@/components/arap/ExportPreview';

export const metadata = { title: 'Accounts Payable Export — FinovaAI' };

export default function AccountsPayableExportPage() {
  return <ExportPreview side="ap" />;
}
