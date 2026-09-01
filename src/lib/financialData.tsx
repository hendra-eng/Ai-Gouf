// Core Financial Data Model - PT Nusantara Teknologi Indonesia
// All values in IDR (Indonesian Rupiah), in millions unless noted

export const COMPANY = {
  name: 'PT Nusantara Teknologi Indonesia',
  shortName: 'PT Nusantara',
  industry: 'Technology & Professional Services',
  currency: 'IDR',
  period: 'Jan 2026 – Aug 2026',
  fiscalYear: 'FY 2026',
  taxId: 'NPWP 01.234.567.8-012.000',
};

// Core P&L Values (in millions IDR)
export const PL_CORE = {
  revenue: 8420,
  cogs: 4700,
  grossProfit: 3720,
  operatingExpenses: 1180,
  ebitda: 2310,
  da: 210,
  ebit: 2330,
  interestExpense: 148,
  ebt: 2182,
  incomeTax: 436,
  netProfit: 1840,
};

// Margins
export const MARGINS = {
  grossMargin: 44.2,
  ebitdaMargin: 27.4,
  ebitMargin: 27.7,
  netMargin: 21.9,
};

// Balance Sheet Values (in millions IDR)
export const BS_CORE = {
  totalAssets: 6840,
  totalLiabilities: 2140,
  totalEquity: 4700,
  cash: 2960,
  bank: 0,
  accountsReceivable: 1240,
  inventory: 380,
  prepaidExpenses: 120,
  otherCurrentAssets: 80,
  property: 820,
  equipment: 640,
  vehicles: 180,
  computerEquipment: 220,
  intangibleAssets: 150,
  otherNonCurrentAssets: 50,
  accountsPayable: 860,
  taxPayable: 182,
  accruedExpenses: 240,
  payrollLiabilities: 180,
  shortTermDebt: 320,
  otherCurrentLiabilities: 98,
  longTermDebt: 180,
  leaseLiabilities: 60,
  otherLongTermLiabilities: 20,
  paidInCapital: 1500,
  additionalPaidInCapital: 500,
  retainedEarnings: 860,
  currentYearProfit: 1840,
  otherEquity: 0,
};

// Cash Flow Values (in millions IDR)
export const CF_CORE = {
  beginningCash: 1840,
  customerCollections: 8680,
  supplierPayments: -4520,
  payrollPayments: -680,
  taxPayments: -436,
  operatingExpensesCF: -320,
  otherOperatingCF: 120,
  netOperatingCF: 2844,
  assetPurchases: -480,
  assetSales: 120,
  equipmentPurchases: -220,
  investments: -80,
  otherInvestingCF: 0,
  netInvestingCF: -660,
  debtProceeds: 320,
  debtRepayment: -280,
  capitalInjection: 0,
  dividendPayments: -640,
  leasePayments: -60,
  otherFinancingCF: -64,
  netFinancingCF: -724,
  netChange: 1460,
  endingCash: 2960,
};

// Monthly P&L Data
export const MONTHLY_PL = [
  { month: 'Jan', revenue: 980, cogs: 548, grossProfit: 432, opEx: 138, ebitda: 268, da: 26, ebit: 272, interest: 18, tax: 51, netProfit: 215 },
  { month: 'Feb', revenue: 1020, cogs: 570, grossProfit: 450, opEx: 142, ebitda: 282, da: 26, ebit: 286, interest: 18, tax: 54, netProfit: 224 },
  { month: 'Mar', revenue: 1050, cogs: 588, grossProfit: 462, opEx: 145, ebitda: 291, da: 26, ebit: 295, interest: 18, tax: 56, netProfit: 231 },
  { month: 'Apr', revenue: 1080, cogs: 604, grossProfit: 476, opEx: 148, ebitda: 300, da: 26, ebit: 304, interest: 18, tax: 57, netProfit: 238 },
  { month: 'May', revenue: 1100, cogs: 615, grossProfit: 485, opEx: 150, ebitda: 306, da: 27, ebit: 310, interest: 19, tax: 58, netProfit: 242 },
  { month: 'Jun', revenue: 1060, cogs: 593, grossProfit: 467, opEx: 146, ebitda: 294, da: 26, ebit: 298, interest: 18, tax: 56, netProfit: 233 },
  { month: 'Jul', revenue: 1060, cogs: 593, grossProfit: 467, opEx: 146, ebitda: 294, da: 27, ebit: 298, interest: 19, tax: 56, netProfit: 232 },
  { month: 'Aug', revenue: 1070, cogs: 589, grossProfit: 481, opEx: 145, ebitda: 295, da: 26, ebit: 300, interest: 18, tax: 48, netProfit: 225 },
];

// Revenue Breakdown
export const REVENUE_BY_CATEGORY = [
  { name: 'Software Development', value: 3200, pct: 38.0 },
  { name: 'IT Consulting', value: 2100, pct: 24.9 },
  { name: 'Managed Services', value: 1680, pct: 19.9 },
  { name: 'Cloud Solutions', value: 840, pct: 10.0 },
  { name: 'Training & Support', value: 600, pct: 7.1 },
];

export const REVENUE_BY_CUSTOMER = [
  { name: 'Bank Mandiri', value: 1680, pct: 20.0 },
  { name: 'Telkom Indonesia', value: 1260, pct: 15.0 },
  { name: 'Pertamina', value: 1050, pct: 12.5 },
  { name: 'BRI', value: 840, pct: 10.0 },
  { name: 'PLN', value: 756, pct: 9.0 },
  { name: 'Others', value: 2834, pct: 33.6 },
];

// Expense Breakdown
export const EXPENSE_BREAKDOWN = [
  { name: 'Payroll', value: 520, pct: 44.1 },
  { name: 'Marketing', value: 210, pct: 17.8 },
  { name: 'Software & Technology', value: 180, pct: 15.3 },
  { name: 'Office & Administration', value: 120, pct: 10.2 },
  { name: 'Professional Services', value: 80, pct: 6.8 },
  { name: 'Travel', value: 40, pct: 3.4 },
  { name: 'Utilities', value: 20, pct: 1.7 },
  { name: 'Other', value: 10, pct: 0.8 },
];

// Budget vs Actual (current period)
export const BUDGET_VS_ACTUAL = [
  { item: 'Revenue', budget: 7800, actual: 8420, variance: 620, variancePct: 7.9 },
  { item: 'COGS', budget: 4400, actual: 4700, variance: -300, variancePct: -6.8 },
  { item: 'Gross Profit', budget: 3400, actual: 3720, variance: 320, variancePct: 9.4 },
  { item: 'Operating Expenses', budget: 1100, actual: 1180, variance: -80, variancePct: -7.3 },
  { item: 'EBITDA', budget: 2100, actual: 2310, variance: 210, variancePct: 10.0 },
  { item: 'Net Profit', budget: 1600, actual: 1840, variance: 240, variancePct: 15.0 },
];

// Full-year Budget P&L structure (in millions IDR)
export const BUDGET = {
  revenue: 10200,
  cogs: 5610,
  grossProfit: 4590,
  operatingExpenses: 1380,
  ebitda: 2550,
  netProfit: 1760,
};

// Full-year Forecast P&L structure (in millions IDR)
export const FORECAST = {
  revenue: 10480,
  cogs: 5720,
  grossProfit: 4760,
  operatingExpenses: 1340,
  ebitda: 2720,
  netProfit: 1910,
};

// Balance Sheet Monthly Trend
export const BS_MONTHLY_TREND = [
  { month: 'Jan', assets: 5820, liabilities: 2380, equity: 3440 },
  { month: 'Feb', assets: 5980, liabilities: 2320, equity: 3660 },
  { month: 'Mar', assets: 6120, liabilities: 2280, equity: 3840 },
  { month: 'Apr', assets: 6280, liabilities: 2240, equity: 4040 },
  { month: 'May', assets: 6420, liabilities: 2220, equity: 4200 },
  { month: 'Jun', assets: 6560, liabilities: 2200, equity: 4360 },
  { month: 'Jul', assets: 6700, liabilities: 2180, equity: 4520 },
  { month: 'Aug', assets: 6840, liabilities: 2140, equity: 4700 },
];

// Cash Flow Monthly
export const CF_MONTHLY = [
  { month: 'Jan', beginCash: 1840, operatingCF: 340, investingCF: -82, financingCF: -90, netChange: 168, endCash: 2008 },
  { month: 'Feb', beginCash: 2008, operatingCF: 358, investingCF: -85, financingCF: -92, netChange: 181, endCash: 2189 },
  { month: 'Mar', beginCash: 2189, operatingCF: 368, investingCF: -88, financingCF: -90, netChange: 190, endCash: 2379 },
  { month: 'Apr', beginCash: 2379, operatingCF: 375, investingCF: -80, financingCF: -92, netChange: 203, endCash: 2582 },
  { month: 'May', beginCash: 2582, operatingCF: 382, investingCF: -82, financingCF: -90, netChange: 210, endCash: 2792 },
  { month: 'Jun', beginCash: 2792, operatingCF: 360, investingCF: -85, financingCF: -92, netChange: 183, endCash: 2975 },
  { month: 'Jul', beginCash: 2975, operatingCF: 355, investingCF: -80, financingCF: -90, netChange: 185, endCash: 3160 },
  { month: 'Aug', beginCash: 3160, operatingCF: 306, investingCF: -78, financingCF: -88, netChange: 140, endCash: 2960 },
];

// Cash Flow Forecast
export const CF_FORECAST = [
  { month: 'Sep 2026', beginCash: 2960, operatingCF: 310, investingCF: -80, financingCF: -90, netChange: 140, endCash: 3100, isForecast: true },
  { month: 'Oct 2026', beginCash: 3100, operatingCF: 320, investingCF: -75, financingCF: -92, netChange: 153, endCash: 3253, isForecast: true },
  { month: 'Nov 2026', beginCash: 3253, operatingCF: 295, investingCF: -80, financingCF: -90, netChange: 125, endCash: 3378, isForecast: true },
  { month: 'Dec 2026', beginCash: 3378, operatingCF: 280, investingCF: -120, financingCF: -640, netChange: -480, endCash: 2898, isForecast: true },
  { month: 'Jan 2027', beginCash: 2898, operatingCF: 300, investingCF: -80, financingCF: -90, netChange: 130, endCash: 3028, isForecast: true },
  { month: 'Feb 2027', beginCash: 3028, operatingCF: 310, investingCF: -75, financingCF: -92, netChange: 143, endCash: 3171, isForecast: true },
];

// AI Insights
export const PL_AI_INSIGHTS = [
  { id: 1, title: 'Revenue Growth', description: 'Revenue increased 12.8% compared with the previous period, driven by strong performance in Software Development and IT Consulting segments.', metric: '+12.8% YoY', severity: 'positive' as const },
  { id: 2, title: 'Margin Pressure', description: 'COGS increased faster than revenue in Q2 2026, compressing gross margin by 1.2 percentage points. Monitor vendor pricing and project costs.', metric: 'GM -1.2pp', severity: 'warning' as const },
  { id: 3, title: 'Expense Driver', description: 'Marketing and payroll are the largest contributors to operating expense growth, representing 61.9% of total operating expenses.', metric: '61.9% of OpEx', severity: 'neutral' as const },
  { id: 4, title: 'Profitability', description: 'Net profit margin remains strong at 21.9%, above the industry benchmark of 18.5% for Technology & Professional Services.', metric: '21.9% vs 18.5%', severity: 'positive' as const },
];

export const BS_AI_INSIGHTS = [
  { id: 1, title: 'Asset Growth', description: 'Total assets increased 17.5% YTD from Rp 5.82M to Rp 6.84M, primarily driven by cash accumulation and accounts receivable growth.', metric: '+17.5% YTD', severity: 'positive' as const },
  { id: 2, title: 'Liquidity', description: 'Current ratio of 2.84x remains well above the minimum threshold of 1.5x, indicating strong short-term liquidity position.', metric: 'CR: 2.84x', severity: 'positive' as const },
  { id: 3, title: 'Debt Exposure', description: 'Long-term debt represents 8.4% of total liabilities. Debt-to-equity ratio of 0.46x is within acceptable range for the industry.', metric: 'D/E: 0.46x', severity: 'neutral' as const },
  { id: 4, title: 'Equity Growth', description: 'Equity increased 36.6% YTD from Rp 3.44M to Rp 4.70M, primarily due to retained profitability and strong net income generation.', metric: '+36.6% YTD', severity: 'positive' as const },
];

export const CF_AI_INSIGHTS = [
  { id: 1, title: 'Healthy Operating Cash Flow', description: 'Operating activities generated Rp 2.84M in positive cash flow, representing a cash conversion rate of 154.6% relative to net profit.', metric: 'OCF: Rp 2.84M', severity: 'positive' as const },
  { id: 2, title: 'Cash Concentration', description: 'Customer collections represent 95.4% of total operating cash inflows, indicating healthy revenue collection efficiency.', metric: '95.4% from customers', severity: 'positive' as const },
  { id: 3, title: 'Upcoming Cash Pressure', description: 'Projected cash balance may decline in December 2026 due to scheduled dividend payments of Rp 640M. Monitor cash position closely.', metric: 'Dec: -Rp 480M', severity: 'warning' as const },
  { id: 4, title: 'Investment Activity', description: 'Capital expenditure of Rp 700M in the current period reflects ongoing investment in equipment and technology infrastructure.', metric: 'CapEx: Rp 700M', severity: 'neutral' as const },
];

// Combined financials object used across Budget, Analytics, Liquidity & Solvency components
export const FINANCIALS = {
  ...PL_CORE,
  ...BS_CORE,
  totalDebt: BS_CORE.shortTermDebt + BS_CORE.longTermDebt,
};

// Utility: Format currency (values expected in millions IDR)
// Canonical IDR structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
export function formatIDR(value: number, compact = true): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (compact) {
    if (abs >= 1000000) return `${sign}Rp ${(abs / 1000000).toFixed(2).replace('.', ',')}T`;
    if (abs >= 1000) return `${sign}Rp ${(abs / 1000).toFixed(2).replace('.', ',')}M`;
    if (abs >= 1) return `${sign}Rp ${abs.toFixed(0)}Jt`;
    return `${sign}Rp ${(abs * 1000).toFixed(0)}Rb`;
  }
  return `${sign}Rp ${abs.toLocaleString('id-ID')}`;
}

export function formatPct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

// Utility: Budget vs Actual variance (values in millions IDR)
export function calcVariance(actual: number, budget: number) {
  const diff = actual - budget;
  const pct = budget !== 0 ? (diff / budget) * 100 : 0;
  return { diff, pct };
}

// Utility: Percentage of total
export function calcPct(value: number, total: number): number {
  return total !== 0 ? (value / total) * 100 : 0;
}

// ============================================================
// Additional exports merged from kodingan 2 (no naming conflicts)
// Note: kodingan 2 used raw-rupiah scale for its Balance Sheet
// totals (totalAssets/totalLiabilities/equity), which did not
// match BS_CORE above — those were intentionally NOT merged.
// Use BS_CORE as the single source of truth for balance sheet figures.
// ============================================================

// Recent transactions feed (for Transactions / Dashboard widgets)
export const RECENT_TRANSACTIONS = [
  { id: 'TXN-2026-0892', date: '28 Aug 2026', description: 'Invoice payment — PT Mitra Solusi', account: 'Cash & Bank', amount: 185_000_000, type: 'credit' as const },
  { id: 'TXN-2026-0891', date: '27 Aug 2026', description: 'Vendor payment — ABC Supplier', account: 'Accounts Payable', amount: -42_000_000, type: 'debit' as const },
  { id: 'TXN-2026-0890', date: '27 Aug 2026', description: 'Payroll — August 2026', account: 'Salaries Expense', amount: -124_000_000, type: 'debit' as const },
  { id: 'TXN-2026-0889', date: '26 Aug 2026', description: 'Service revenue — PT Karya Digital', account: 'Revenue', amount: 68_000_000, type: 'credit' as const },
  { id: 'TXN-2026-0888', date: '26 Aug 2026', description: 'Office rent — August 2026', account: 'Rent Expense', amount: -22_500_000, type: 'debit' as const },
];

// Simplified monthly summary (revenue/expenses/profit/cash) — separate from
// MONTHLY_PL above, which has full P&L line items. Values in raw IDR.
export const MONTHLY_SUMMARY = [
  { month: 'Jan', revenue: 980_000_000, expenses: 720_000_000, profit: 260_000_000, cash: 2_400_000_000 },
  { month: 'Feb', revenue: 1_020_000_000, expenses: 740_000_000, profit: 280_000_000, cash: 2_520_000_000 },
  { month: 'Mar', revenue: 1_100_000_000, expenses: 780_000_000, profit: 320_000_000, cash: 2_680_000_000 },
  { month: 'Apr', revenue: 1_050_000_000, expenses: 760_000_000, profit: 290_000_000, cash: 2_750_000_000 },
  { month: 'May', revenue: 1_080_000_000, expenses: 790_000_000, profit: 290_000_000, cash: 2_820_000_000 },
  { month: 'Jun', revenue: 1_120_000_000, expenses: 810_000_000, profit: 310_000_000, cash: 2_880_000_000 },
  { month: 'Jul', revenue: 1_030_000_000, expenses: 750_000_000, profit: 280_000_000, cash: 2_920_000_000 },
  { month: 'Aug', revenue: 1_040_000_000, expenses: 760_000_000, profit: 280_000_000, cash: 2_960_000_000 },
];

// ------------------------------------------------------------
// Backward-compat aliases for pages still importing old names
// from kodingan 2 (e.g. src/app/ai-analytics/page.tsx). Keeps
// those pages working without editing every page.tsx by hand.
// ------------------------------------------------------------
export const monthlyData = MONTHLY_SUMMARY;
export const PERIOD = COMPANY.period;