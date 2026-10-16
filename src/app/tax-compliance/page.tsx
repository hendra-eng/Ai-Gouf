import TaxCompliancePage from './components/TaxWorkspace';

export const metadata = {
  title: 'Tax Compliance — zafeb',
  description: 'Tax ledger from posted transactions, PPh, VAT, payments, filings, reconciliation and exceptions.',
};

export default function TaxComplianceRoute() {
  return <TaxCompliancePage />;
}
