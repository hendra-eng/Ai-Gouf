import CreateInvoiceForm from '@/components/arap/CreateInvoiceForm';

export const metadata = { title: 'Add Sales Transaction — zafeb' };

export default function CreateSalesInvoicePage() {
  return <CreateInvoiceForm context="sales" />;
}
