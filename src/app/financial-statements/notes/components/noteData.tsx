export interface NoteTableRow {
  id: string;
  cells: string[];
  isTotal?: boolean;
  isSubtotal?: boolean;
}

export interface NoteTable {
  id: string;
  headers: string[];
  rows: NoteTableRow[];
}

export interface AccordionItem {
  id: string;
  title: string;
  content: string;
}

export interface CrossRef {
  id: string;
  label: string;
}

export interface NoteData {
  num: string;
  title: string;
  tag: 'Policy Note' | 'Disclosed' | 'Supporting Schedule';
  relatedStatement: string;
  intro: string;
  tables?: NoteTable[];
  accordion?: AccordionItem[];
  crossRefs?: CrossRef[];
}

export const allNotes: NoteData[] = [
  {
    num: '01', title: 'General Information',
    tag: 'Policy Note', relatedStatement: 'All Statements',
    intro: 'PT Nusantara Teknologi Indonesia ("the Company") was incorporated in Indonesia and is domiciled in Jakarta. The Company is primarily engaged in the development and distribution of enterprise technology solutions, cloud infrastructure services, and software licensing. The Company\'s shares are held by PT Nusantara Group (67%) and institutional investors (33%). These financial statements cover the period from 1 January 2026 to 31 August 2026 and were authorized for issue by the Board of Directors on 5 September 2026.',
  },
  {
    num: '02', title: 'Basis of Preparation',
    tag: 'Policy Note', relatedStatement: 'All Statements',
    intro: 'These financial statements have been prepared in accordance with Indonesian Financial Accounting Standards (PSAK) issued by the Indonesian Institute of Accountants (IAI). The statements are prepared on a historical cost basis, except for certain financial instruments measured at fair value. The presentation currency is United States Dollars (USD) and all amounts are rounded to the nearest dollar unless otherwise stated. The going concern assumption has been applied in preparing these statements.',
  },
  {
    num: '03', title: 'Material Accounting Policies',
    tag: 'Policy Note', relatedStatement: 'All Statements',
    intro: 'The following significant accounting policies have been applied consistently in the preparation of these financial statements for all periods presented.',
    accordion: [
      {
        id: 'acc-rev', title: 'Revenue Recognition',
        content: 'Revenue is recognized when control of goods or services is transferred to the customer and the related performance obligation has been satisfied. For software licenses, revenue is recognized at the point of delivery. For subscription and maintenance services, revenue is recognized ratably over the service period.',
      },
      {
        id: 'acc-fi', title: 'Financial Instruments',
        content: 'Financial assets are classified at initial recognition as measured at amortized cost, fair value through other comprehensive income (FVOCI), or fair value through profit or loss (FVTPL). Expected credit losses (ECL) are recognized for all financial assets measured at amortized cost.',
      },
      {
        id: 'acc-inv', title: 'Inventory Valuation',
        content: 'Inventories are measured at the lower of cost and net realizable value. Cost is determined using the weighted average cost method and includes all costs of purchase, costs of conversion, and other costs incurred in bringing inventories to their present location and condition.',
      },
      {
        id: 'acc-ppe', title: 'Property & Equipment',
        content: 'Property and equipment are stated at cost less accumulated depreciation and accumulated impairment losses. Cost includes expenditure directly attributable to the acquisition of the asset.',
      },
      {
        id: 'acc-dep', title: 'Depreciation',
        content: 'Depreciation is calculated using the straight-line method over the estimated useful lives: Buildings 20 years; Computer equipment 3–5 years; Furniture 5–8 years; Motor vehicles 4–5 years; Leasehold improvements over the remaining lease term.',
      },
      {
        id: 'acc-lease', title: 'Leases',
        content: 'The Company recognizes right-of-use assets and lease liabilities for all leases with a term exceeding 12 months. Right-of-use assets are depreciated on a straight-line basis over the shorter of the lease term and the useful life of the underlying asset.',
      },
      {
        id: 'acc-emp', title: 'Employee Benefits',
        content: 'Short-term employee benefits are recognized as an expense when the Company has a present obligation to pay. Post-employment defined benefit obligations are measured using the projected unit credit method.',
      },
      {
        id: 'acc-tax', title: 'Income Tax',
        content: 'Current tax is the expected tax payable on taxable income for the year, using tax rates enacted at the reporting date. Deferred tax is recognized using the balance sheet liability method for temporary differences between carrying amounts and tax bases.',
      },
    ],
  },
  {
    num: '04', title: 'Cash & Cash Equivalents',
    tag: 'Disclosed', relatedStatement: 'Balance Sheet',
    intro: 'Cash and cash equivalents consist of cash on hand and balances maintained with banks that are readily convertible to known amounts of cash and subject to insignificant risk of changes in value.',
    tables: [{
      id: 't-cash', headers: ['', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'cash-1', cells: ['Cash on Hand', '48,500', '41,200'] },
        { id: 'cash-2', cells: ['PT Bank Central Asia — IDR', '8,140,000', '6,920,000'] },
        { id: 'cash-3', cells: ['PT Bank Mandiri — IDR', '5,380,000', '4,610,000'] },
        { id: 'cash-4', cells: ['Citibank N.A. — USD Account', '3,820,000', '2,980,000'] },
        { id: 'cash-5', cells: ['Time Deposits (maturity < 3M)', '1,311,500', '980,000'] },
        { id: 'cash-t', cells: ['Total Cash & Cash Equivalents', '18,700,000', '15,531,200'], isTotal: true },
      ],
    }],
    crossRefs: [{ id: 'xr-cash', label: 'Balance Sheet' }],
  },
  {
    num: '05', title: 'Trade Receivables',
    tag: 'Disclosed', relatedStatement: 'Balance Sheet',
    intro: 'Trade receivables are amounts due from customers for services rendered and products delivered. They are measured at amortized cost, net of expected credit loss (ECL) allowances.',
    tables: [{
      id: 't-ar', headers: ['', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'ar-1', cells: ['Gross Trade Receivables', '9,240,000', '7,850,000'] },
        { id: 'ar-2', cells: ['Allowance for Expected Credit Loss', '(1,440,000)', '(1,180,000)'] },
        { id: 'ar-t', cells: ['Net Trade Receivables', '7,800,000', '6,670,000'], isTotal: true },
        { id: 'ar-3', cells: ['  — Current (0–30 days)', '5,460,000', '4,290,000'] },
        { id: 'ar-4', cells: ['  — 31–60 days', '1,248,000', '1,140,000'] },
        { id: 'ar-5', cells: ['  — 61–90 days', '672,000', '810,000'] },
        { id: 'ar-6', cells: ['  — Over 90 days', '420,000', '430,000'] },
      ],
    }],
    crossRefs: [{ id: 'xr-ar', label: 'Balance Sheet' }],
  },
  {
    num: '06', title: 'Inventories',
    tag: 'Supporting Schedule', relatedStatement: 'Balance Sheet',
    intro: 'Inventories consist of hardware components held for resale and raw materials for custom server assembly. Valued at the lower of cost (weighted average) and net realizable value.',
    tables: [{
      id: 't-inv', headers: ['', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'inv-1', cells: ['Raw Materials & Components', '1,840,000', '1,560,000'] },
        { id: 'inv-2', cells: ['Work in Progress', '620,000', '480,000'] },
        { id: 'inv-3', cells: ['Finished Goods', '1,120,000', '980,000'] },
        { id: 'inv-4', cells: ['Inventory Write-down', '(80,000)', '(60,000)'] },
        { id: 'inv-t', cells: ['Net Inventories', '3,500,000', '2,960,000'], isTotal: true },
      ],
    }],
  },
  {
    num: '07', title: 'Property & Equipment',
    tag: 'Supporting Schedule', relatedStatement: 'Balance Sheet',
    intro: 'Property and equipment are stated at cost less accumulated depreciation and impairment losses. The Company holds server infrastructure, IT equipment, leasehold improvements, and motor vehicles.',
    tables: [{
      id: 't-ppe',
      headers: ['', 'Server Infra', 'IT Equipment', 'Leasehold', 'Vehicles', 'Total'],
      rows: [
        { id: 'ppe-1', cells: ['Opening Carrying Amount', '4,200,000', '1,840,000', '680,000', '320,000', '7,040,000'] },
        { id: 'ppe-2', cells: ['Additions', '960,000', '420,000', '—', '—', '1,380,000'] },
        { id: 'ppe-3', cells: ['Disposals', '—', '(85,000)', '—', '—', '(85,000)'] },
        { id: 'ppe-4', cells: ['Depreciation', '(640,000)', '(320,000)', '(84,000)', '(48,000)', '(1,092,000)'] },
        { id: 'ppe-t', cells: ['Closing Carrying Amount', '4,520,000', '1,855,000', '596,000', '272,000', '7,243,000'], isTotal: true },
      ],
    }],
    crossRefs: [{ id: 'xr-ppe', label: 'Balance Sheet' }],
  },
  {
    num: '08', title: 'Trade Payables',
    tag: 'Disclosed', relatedStatement: 'Balance Sheet',
    intro: 'Trade payables are obligations to pay for goods and services acquired in the ordinary course of business. Measured at amortized cost.',
    tables: [{
      id: 't-ap', headers: ['', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'ap-1', cells: ['Trade Payables — Domestic', '2,840,000', '2,420,000'] },
        { id: 'ap-2', cells: ['Trade Payables — Foreign', '980,000', '740,000'] },
        { id: 'ap-3', cells: ['Accrued Expenses', '1,140,000', '960,000'] },
        { id: 'ap-4', cells: ['Other Payables', '440,000', '380,000'] },
        { id: 'ap-t', cells: ['Total Trade Payables', '5,400,000', '4,500,000'], isTotal: true },
      ],
    }],
    crossRefs: [{ id: 'xr-ap', label: 'Balance Sheet' }],
  },
  {
    num: '09', title: 'Borrowings',
    tag: 'Disclosed', relatedStatement: 'Balance Sheet',
    intro: 'Borrowings consist of revolving credit facilities and term loans from domestic banks, secured by Company assets and subject to financial maintenance covenants.',
    tables: [{
      id: 't-borrow', headers: ['', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'bw-1', cells: ['Revolving Credit — PT Bank Mandiri (6.5% p.a.)', '2,500,000', '2,000,000'] },
        { id: 'bw-2', cells: ['Term Loan — PT Bank BRI (7.2% p.a.)', '4,200,000', '4,800,000'] },
        { id: 'bw-t', cells: ['Total Borrowings', '6,700,000', '6,800,000'], isTotal: true },
        { id: 'bw-3', cells: ['Current portion (due within 12 months)', '1,200,000', '1,200,000'] },
        { id: 'bw-4', cells: ['Non-current portion', '5,500,000', '5,600,000'] },
      ],
    }],
  },
  {
    num: '10', title: 'Equity',
    tag: 'Disclosed', relatedStatement: 'Equity Statement',
    intro: 'The Company\'s authorized share capital is 20,000,000 ordinary shares at par value USD 0.50 per share. As at 31 August 2026, 11,000,000 shares were issued and fully paid. Refer to the Statement of Changes in Equity for full reconciliation.',
    tables: [{
      id: 't-eq', headers: ['', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'eq-1', cells: ['Share Capital (11,000,000 shares @ $0.50)', '5,500,000', '5,000,000'] },
        { id: 'eq-2', cells: ['Additional Paid-in Capital', '1,450,000', '1,200,000'] },
        { id: 'eq-3', cells: ['Retained Earnings', '3,365,000', '1,980,000'] },
        { id: 'eq-4', cells: ['Other Comprehensive Income', '90,000', '140,000'] },
        { id: 'eq-5', cells: ['Other Equity', '100,000', '100,000'] },
        { id: 'eq-t', cells: ['Total Equity', '10,505,000', '8,420,000'], isTotal: true },
      ],
    }],
    crossRefs: [{ id: 'xr-eq', label: 'Equity Statement' }],
  },
  {
    num: '11', title: 'Revenue',
    tag: 'Disclosed', relatedStatement: 'Profit & Loss',
    intro: 'Revenue is disaggregated by major product and service lines. All revenue is recognized upon satisfaction of performance obligations as described in Note 03.',
    tables: [{
      id: 't-rev', headers: ['', 'Jan–Aug 2026', 'Jan–Aug 2025'],
      rows: [
        { id: 'rv-1', cells: ['Software Licensing', '32,480,000', '27,640,000'] },
        { id: 'rv-2', cells: ['Cloud Infrastructure Services', '24,160,000', '19,820,000'] },
        { id: 'rv-3', cells: ['Professional Services', '12,840,000', '11,200,000'] },
        { id: 'rv-4', cells: ['Maintenance & Support', '5,920,000', '5,340,000'] },
        { id: 'rv-5', cells: ['Hardware Sales', '1,800,000', '2,120,000'] },
        { id: 'rv-t', cells: ['Total Revenue', '77,200,000', '66,120,000'], isTotal: true },
      ],
    }],
    crossRefs: [{ id: 'xr-rev', label: 'Profit & Loss' }],
  },
  {
    num: '12', title: 'Operating Expenses',
    tag: 'Disclosed', relatedStatement: 'Profit & Loss',
    intro: 'Operating expenses include all costs incurred in generating revenue and managing the Company\'s operations during the reporting period.',
    tables: [{
      id: 't-opex', headers: ['', 'Jan–Aug 2026', 'Jan–Aug 2025'],
      rows: [
        { id: 'ox-1', cells: ['Cost of Revenue', '28,640,000', '25,180,000'] },
        { id: 'ox-2', cells: ['Personnel Expenses', '18,920,000', '16,440,000'] },
        { id: 'ox-3', cells: ['General & Administrative', '6,840,000', '6,120,000'] },
        { id: 'ox-4', cells: ['Sales & Marketing', '4,160,000', '3,680,000'] },
        { id: 'ox-5', cells: ['Depreciation & Amortization', '1,092,000', '980,000'] },
        { id: 'ox-6', cells: ['Other Operating Expenses', '3,748,000', '3,220,000'] },
        { id: 'ox-t', cells: ['Total Operating Expenses', '63,400,000', '55,620,000'], isTotal: true },
      ],
    }],
    crossRefs: [{ id: 'xr-opex', label: 'Profit & Loss' }],
  },
  {
    num: '13', title: 'Income Tax',
    tag: 'Disclosed', relatedStatement: 'Profit & Loss',
    intro: 'The Company is subject to Indonesian corporate income tax at 22%. Deferred tax is recognized for temporary differences between financial reporting and tax carrying amounts.',
    tables: [{
      id: 't-tax', headers: ['', 'Jan–Aug 2026', 'Jan–Aug 2025'],
      rows: [
        { id: 'tx-1', cells: ['Profit Before Tax', '2,560,000', '2,120,000'] },
        { id: 'tx-2', cells: ['Current Tax Expense', '(563,200)', '(466,400)'] },
        { id: 'tx-3', cells: ['Deferred Tax Expense', '(156,800)', '(93,600)'] },
        { id: 'tx-t', cells: ['Total Income Tax Expense', '(720,000)', '(560,000)'], isTotal: true },
        { id: 'tx-4', cells: ['Net Profit After Tax', '1,840,000', '1,560,000'] },
        { id: 'tx-5', cells: ['Effective Tax Rate', '28.1%', '26.4%'] },
      ],
    }],
    crossRefs: [{ id: 'xr-tax', label: 'Profit & Loss' }],
  },
  {
    num: '14', title: 'Related Parties',
    tag: 'Disclosed', relatedStatement: 'All Statements',
    intro: 'The Company has transactions with PT Nusantara Group (parent), PT Nusantara Digital (sister company), and key management personnel. All transactions are conducted on arm\'s length terms.',
    tables: [{
      id: 't-rp', headers: ['Party', 'Nature of Transaction', 'Aug 2026', 'Dec 2025'],
      rows: [
        { id: 'rp-1', cells: ['PT Nusantara Group', 'Management Fee Payable', '(480,000)', '(420,000)'] },
        { id: 'rp-2', cells: ['PT Nusantara Digital', 'Intercompany Revenue', '2,840,000', '2,240,000'] },
        { id: 'rp-3', cells: ['PT Nusantara Digital', 'Intercompany Receivable', '640,000', '520,000'] },
        { id: 'rp-4', cells: ['Key Management', 'Total Remuneration', '(1,280,000)', '(1,120,000)'] },
      ],
    }],
  },
  {
    num: '15', title: 'Commitments & Contingencies',
    tag: 'Disclosed', relatedStatement: 'Balance Sheet',
    intro: 'The Company has operating lease commitments for office premises in Jakarta, Surabaya, and Bali. No material contingent liabilities have been identified as at the reporting date.',
    tables: [{
      id: 't-commit', headers: ['Operating Lease Commitments', 'USD'],
      rows: [
        { id: 'cm-1', cells: ['Within 1 year', '1,240,000'] },
        { id: 'cm-2', cells: ['1 to 5 years', '3,680,000'] },
        { id: 'cm-3', cells: ['More than 5 years', '1,920,000'] },
        { id: 'cm-t', cells: ['Total Commitments', '6,840,000'], isTotal: true },
      ],
    }],
  },
  {
    num: '16', title: 'Subsequent Events',
    tag: 'Disclosed', relatedStatement: 'All Statements',
    intro: 'The following material events occurred after the balance sheet date of 31 August 2026 and before the authorization date of 5 September 2026.',
    tables: [{
      id: 't-sub', headers: ['Event', 'Date', 'Financial Impact'],
      rows: [
        { id: 'se-1', cells: ['Board approved final dividend of $0.04 per share', '2 Sep 2026', 'USD 440,000'] },
        { id: 'se-2', cells: ['New 3-year cloud services contract — PT Astra International', '3 Sep 2026', 'USD 4,800,000'] },
        { id: 'se-3', cells: ['No other material subsequent events identified', '5 Sep 2026', '—'] },
      ],
    }],
  },
];