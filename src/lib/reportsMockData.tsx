// Backend integration point: replace with API calls to /api/reports

export type ReportCategory =
  | 'financial-statements' |'management' |'tax' |'ar-ap' |'budget' |'audit' |'custom';

// [BARU] 'Word' ditambahkan karena CALK asli (lihat downloadCalk() di
// agent-ai/lib/api.js) bisa diunduh sebagai .docx, bukan cuma PDF/Excel/CSV.
export type ReportFormat = 'PDF' | 'Excel' | 'CSV' | 'Word';
export type ReportStatus = 'ready' | 'generating' | 'scheduled' | 'error';

export interface Report {
  id: string;
  name: string;
  description: string;
  category: ReportCategory;
  period: string;
  lastGenerated: string;
  createdBy: string;
  formats: ReportFormat[];
  status: ReportStatus;
  size?: string;
  tags?: string[];
}

export interface ScheduledReport {
  id: string;
  reportName: string;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
  recipients: string[];
  nextRun: string;
  status: 'Active' | 'Paused' | 'Error';
  format: ReportFormat;
}

export const reportCategories = [
  { id: 'all', label: 'All Reports', icon: 'LayoutGrid', count: 0 },
  { id: 'financial-statements', label: 'Financial Statements', icon: 'FileBarChart', count: 0 },
  { id: 'management', label: 'Management Reports', icon: 'TrendingUp', count: 0 },
  { id: 'tax', label: 'Tax Reports', icon: 'Receipt', count: 0 },
  { id: 'ar-ap', label: 'AR/AP Reports', icon: 'ArrowLeftRight', count: 0 },
  { id: 'budget', label: 'Budget Reports', icon: 'Target', count: 0 },
  { id: 'audit', label: 'Audit Reports', icon: 'ShieldCheck', count: 0 },
  { id: 'custom', label: 'Custom Reports', icon: 'Sliders', count: 0 },
];

export const reports: Report[] = [];

export const scheduledReports: ScheduledReport[] = [];

export const reportPreviewData = {
  profitLoss: {
    revenue: [
      { label: 'Product Sales', amount: 0 },
      { label: 'Service Revenue', amount: 0 },
      { label: 'Other Income', amount: 0 },
    ],
    totalRevenue: 0,
    cogs: 0,
    grossProfit: 0,
    operatingExpenses: [
      { label: 'Salaries & Benefits', amount: 0 },
      { label: 'Marketing & Sales', amount: 0 },
      { label: 'General & Administrative', amount: 0 },
      { label: 'Depreciation', amount: 0 },
      { label: 'Other Operating', amount: 0 },
    ],
    totalOpex: 0,
    ebit: 0,
    interestExpense: 0,
    taxExpense: 0,
    netProfit: 0,
  },
};