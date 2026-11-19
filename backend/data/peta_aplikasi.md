# PETA APLIKASI DASHBOARDORI (dibuat otomatis dari kode)
Dibuat: 2026-11-19T08:43:06. Jangan diedit manual; jalankan `python scripts/buat_peta_aplikasi.py`.

## Ringkasan angka (dihitung dari kode)
- Total halaman (URL): 85, terdiri dari 37 halaman yang ada di menu sidebar dan 48 halaman tambahan (form baru, pratinjau, exceptions, posted, dst.) yang dibuka dari tombol/tab di halaman lain.
- Entri menu sidebar: 37 dalam 6 grup.
- File komponen UI (.tsx): 425.
- Tag <button> di source code: 1328. Entri tombol berlabel yang tercatat per halaman: 1568 (komponen bersama seperti tabel/modal dihitung di tiap halaman yang memakainya); link antarhalaman: 161.

## Menu sidebar (urutan tampil)
**Overview**
- Overview → `/`
- Memori AI → `/memori-ai`
**Financial**
- Financial Statements → `/financial-statements`
  - Profit & Loss → `/financial-statements/profit-loss`
  - Balance Sheet → `/financial-statements/balance-sheet`
  - Cash Flow → `/financial-statements/cash-flow`
  - Statement of Changes in Equity → `/financial-statements/changes-in-equity`
  - Notes to Financial Statements → `/financial-statements/notes`
  - Statement Mapping → `/financial-statements/mapping`
- Transactions → `/transactions`
  - Sales → `/transactions/sales`
  - Purchase → `/transactions/purchase`
  - Journal Entry → `/transactions/journal-entry`
  - Cash & Bank → `/transactions/bank-cash`
  - Other → `/transactions/other`
- Accounts Receivable → `/accounts-receivable`
- Accounts Payable → `/accounts-payable`
- FX Revaluation → `/fx-revaluation`
- FX Transfers → `/fx-transfers`
**Assets & Equity**
- Fixed Assets → `/assets`
- Inventory → `/inventory`
- Liabilities → `/liabilities`
- Equity → `/equity`
**Planning**
- Budget & Forecast → `/budget-forecast`
- Tax Compliance → `/tax-compliance`
- Financial Analytics → `/financial-analytics`
**Intelligence**
- AI Financial Analyst → `/ai-financial-analyst`
- Audit → `/audit`
**Management**
- Reports → `/reports`
- Clients → `/clients`
- Chart of Accounts → `/coa`
- Year-End Closing → `/year-end-closing`
- Exchange Rates → `/exchange-rates`
- Documents → `/documents`
- Settings → `/settings`
- Payroll → `/payroll`
- Agentic AI → `/agentic-ai`

## Hak akses per role (tombol bisa nonaktif/tersembunyi sesuai level)
- tahap_1 = level 1: Junior Staff
- tahap_2 = level 2: Senior Staff
- tahap_3 = level 3: Supervisor
- tahap_4 = level 4: Manager
- tahap_5 = level 5: Partner / Direktur (Akses Penuh)
- super_admin = level 999: Super Admin (di atas Tahap 5)
- Aksi level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen
- Aksi level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
- Aksi level 3+ (JE_LEVEL_APPROVE): approve / reject / reopen / hapus jurnal (Journal Entry)
- Aksi level 4+ (JE_LEVEL_POST): posting jurnal ke buku besar (Journal Entry)
- Aksi level 4+ (LEVEL_BALIK_JURNAL): membalik jurnal yang sudah diposting (Cash & Bank)

## Komponen global (ada di semua halaman)
Tombol/aksi global: Tutup; Riwayat pesan; Perkecil / Perbesar; Obrolan baru; Coba lagi; <judul> Percakapan saat ini / Ketuk untuk membuka; Hapus?; Tanya sesuatu; [label dari data: teks]; Tersalin / Salin; Ke pesan terbaru; Hapus gambar; Lampirkan gambar; Stop; Kirim; Tutup chat / Buka chat; No clients yet; No clients yet Add your first client on the Clients page → /clients; [label dari data: badan, nama]; [label dari data: company]; [label dari data: c]; [label dari data: period]; [label dari data: p]; Ask AI; [ikon Question Mark Circle]; Collapse submenu / Expand submenu; Collapse sidebar; Expand sidebar; Settings; Logout; [ikon X]; Open menu; [label dari data: period.label, period.range]; [label dari data: p.label]; Apply; Profile → /settings; Account Settings → /settings; Log out

## Daftar halaman (satu per satu)

### `/` — Overview
Grup menu: Overview
Judul/seksi di halaman: Financial Overview; append replace-group / Ganti Transaksi … (PDF) replace / jurnal_penjualan_kasir / Import Jurnal Penj; Aktual vs Anggaran / Pendapatan: Tahun Ini vs Tahun Lalu / Revenue vs Expenses vs Net Profit
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Area; Line; Column; Candle; OHLC Bar; Auto; 6M · 6 Months; YTD · Year to Date; 12M · 12 Months; 3Y · 3 Years
Komponen (12): OverviewContent, AppIcon, TransactionsContext, ImportRekeningKoranModal, KPIBentoGrid, OverviewCharts, MetricCard, LoadingSkeleton, InteractiveDonutChart, salesStyleKit, SalesCandleLayer, SalesChartCrosshair
Tombol/aksi (15):
- Import
- Export
- Muat ulang data dashboard (bisa nonaktif sesuai kondisi)
- [ikon X]
- Rekening Koran Mutasi bank — Excel/PDF
- Jurnal Penjualan Kasir Laporan penjualan detail — PDF
- Coba File Lain
- Lanjutkan Semua ( <hasil.draf_jurnal.length> transaksi)
- Hanya Baris Baru ( <pendingImport.entriBaru.length> transaksi) (bisa nonaktif sesuai kondisi)
- Batal, kembali ke pratinjau
- Batal
- append / Tambahkan … Transaksi Ini replace-group replace / Ganti Tabel dengan … Transaksi 
- Reset
- [ikon Chevron Down]
- [label dari data: o.label]
Link ke halaman lain: Accounts Receivable → /accounts-receivable; Accounts Payable → /accounts-payable; AI Financial Analyst 0 analyses ready Ask a financial question → → /ai-financial-analyst
Isian/filter: select; file; checkbox; input:Cari...

### `/accounts-payable` — Accounts Payable
Grup menu: Financial
Judul/seksi di halaman: Email Statement; Edit … / Record …
Tab di halaman (termasuk tab di panel detail): Overview; Aging; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Receivables; Collected This Month; Promise to Pay; High Priority Accounts; All open; Overdue; Partially paid; Not yet due; Last 6 months; Last 12 months; All statuses; All; Paid; IDR - Indonesian Rupiah; All deliveries; All priorities; Unassigned; Avg. Days to Collect; Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount
Komponen (13): ArApWorkspace, arapSalesUi, PageHeading, OverviewTab, InvoicesTab, AgingTab, SettlementsTab, StatementsTab, CollectionsTab, FilterSelect, SettlementForm, arapUi, CurrencyRateFields
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (54):
- Export (bisa nonaktif sesuai kondisi)
- Retry
- [label dari data: t.label]
- Today
- Refresh
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- View
- More actions
- See all
- [label dari data: t.party]
- Hide / Show
- Filter
- Reset Filter (bisa nonaktif sesuai kondisi)
- Export Excel
- Export CSV
- Clear
- [label dari data: d.no]
- all / Filter
- [label dari data: labelEmber[b]]
- Toggle details
- Statement
- Post / Submit (bisa nonaktif sesuai kondisi)
- [label dari data: s.tx_number]
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Print (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- Preview
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [label dari data: COLLECTION_STATUS_LABEL[s], n]
- Assign collector
- Set status
- Set priority
- [label dari data: a.party]
- Log Follow-up
- Save Follow-up (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Save Draft (bisa nonaktif sesuai kondisi)
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted; View Aging Report → …/export?as_of=…; Edit → …/invoices/new?id=…; Journal Preview → /transactions/sales?tab=journal-preview; Edit → …?id=…; Record Receipt → …/receipts/new?party=…
Isian/filter: date; label:As of; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; label:⟨label⟩ ⟨children⟩; input:Search …, … number...; input; checkbox:Select page; checkbox:Select …; checkbox; label:Include zero balance; input:Search number, …, …...; date:Period start; date:Period end; input:Search …, period...; input:finance@customer.co.id; input:Separate multiple addresses with commas; textarea; label:⟨cfg.party⟩ *; label:Statement Period *; label:Currency; label:To *; label:Save as this customer&apos;s email; label:Cc; label:Subject; label:Message; input:Search customer, invoice number...

### `/accounts-payable/export` — Export PDF / Print Preview
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Export PDF / Print Preview; Export Settings; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): A4 (210 x 297 mm); Letter (216 x 279 mm); Legal (216 x 356 mm); IDR - Indonesian Rupiah; All deliveries
Komponen (5): ExportPreview, arapUi, StatementsTab, FilterSelect, arapSalesUi
Tombol/aksi (25):
- Export PDF (bisa nonaktif sesuai kondisi)
- Download Excel (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- Print (bisa nonaktif sesuai kondisi)
- [label dari data: o]
- Apply & Refresh Preview (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- Preview
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date:From; date:To; date; label:Report Type; label:Client / Company; label:Period; label:⟨cfg.party⟩ Group; label:Paper Size; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; date:Period start; date:Period end; input:Search …, period...; input:finance@customer.co.id; checkbox; input:Separate multiple addresses with commas; input; textarea; label:⟨cfg.party⟩ *; label:Statement Period *; label:Currency; label:To *; label:Save as this customer&apos;s email; label:Cc; label:Subject; label:Message; label:⟨label⟩ ⟨children⟩

### `/accounts-payable/payments/new` — Edit … / Record …
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Edit … / Record …; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount; IDR - Indonesian Rupiah; All deliveries
Komponen (6): SettlementForm, arapUi, StatementsTab, CurrencyRateFields, FilterSelect, arapSalesUi
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (26):
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Save Draft (bisa nonaktif sesuai kondisi)
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Print (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- Preview
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:0; date; input; input:Transfer / cheque number; textarea:ar / e.g. Partial settlement of invoices / e.g. Payment for J; input:Search … number...; checkbox:Select all; checkbox:Select …; checkbox; label:⟨children⟩; label:Record an unapplied amount ⟨cfg.unappliedHint⟩; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; date:Period start; date:Period end; input:Search …, period...; input:finance@customer.co.id; input:Separate multiple addresses with commas; textarea; label:⟨cfg.party⟩ *; label:Statement Period *; label:Currency; label:To *; label:Save as this customer&apos;s email; label:Cc; label:Subject; label:Message

### `/accounts-receivable` — Accounts Receivable
Grup menu: Financial
Judul/seksi di halaman: Email Statement; Edit … / Record …
Tab di halaman (termasuk tab di panel detail): Overview; Aging; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Receivables; Collected This Month; Promise to Pay; High Priority Accounts; All open; Overdue; Partially paid; Not yet due; Last 6 months; Last 12 months; All statuses; All; Paid; IDR - Indonesian Rupiah; All deliveries; All priorities; Unassigned; Avg. Days to Collect; Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount
Komponen (13): ArApWorkspace, arapSalesUi, PageHeading, OverviewTab, InvoicesTab, AgingTab, SettlementsTab, StatementsTab, CollectionsTab, FilterSelect, SettlementForm, arapUi, CurrencyRateFields
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (54):
- Export (bisa nonaktif sesuai kondisi)
- Retry
- [label dari data: t.label]
- Today
- Refresh
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- View
- More actions
- See all
- [label dari data: t.party]
- Hide / Show
- Filter
- Reset Filter (bisa nonaktif sesuai kondisi)
- Export Excel
- Export CSV
- Clear
- [label dari data: d.no]
- all / Filter
- [label dari data: labelEmber[b]]
- Toggle details
- Statement
- Post / Submit (bisa nonaktif sesuai kondisi)
- [label dari data: s.tx_number]
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Print (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- Preview
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [label dari data: COLLECTION_STATUS_LABEL[s], n]
- Assign collector
- Set status
- Set priority
- [label dari data: a.party]
- Log Follow-up
- Save Follow-up (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Save Draft (bisa nonaktif sesuai kondisi)
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted; View Aging Report → …/export?as_of=…; Edit → …/invoices/new?id=…; Journal Preview → /transactions/sales?tab=journal-preview; Edit → …?id=…; Record Receipt → …/receipts/new?party=…
Isian/filter: date; label:As of; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; label:⟨label⟩ ⟨children⟩; input:Search …, … number...; input; checkbox:Select page; checkbox:Select …; checkbox; label:Include zero balance; input:Search number, …, …...; date:Period start; date:Period end; input:Search …, period...; input:finance@customer.co.id; input:Separate multiple addresses with commas; textarea; label:⟨cfg.party⟩ *; label:Statement Period *; label:Currency; label:To *; label:Save as this customer&apos;s email; label:Cc; label:Subject; label:Message; input:Search customer, invoice number...

### `/accounts-receivable/export` — Export PDF / Print Preview
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Export PDF / Print Preview; Export Settings; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): A4 (210 x 297 mm); Letter (216 x 279 mm); Legal (216 x 356 mm); IDR - Indonesian Rupiah; All deliveries
Komponen (5): ExportPreview, arapUi, StatementsTab, FilterSelect, arapSalesUi
Tombol/aksi (25):
- Export PDF (bisa nonaktif sesuai kondisi)
- Download Excel (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- Print (bisa nonaktif sesuai kondisi)
- [label dari data: o]
- Apply & Refresh Preview (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- Preview
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date:From; date:To; date; label:Report Type; label:Client / Company; label:Period; label:⟨cfg.party⟩ Group; label:Paper Size; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; date:Period start; date:Period end; input:Search …, period...; input:finance@customer.co.id; checkbox; input:Separate multiple addresses with commas; input; textarea; label:⟨cfg.party⟩ *; label:Statement Period *; label:Currency; label:To *; label:Save as this customer&apos;s email; label:Cc; label:Subject; label:Message; label:⟨label⟩ ⟨children⟩

### `/accounts-receivable/invoices/new` — Import from Product
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Import from Product; Invoice Preview; INVOICE; Edit Invoice / Create Invoice; Edit … / Record …; Customer Details / New Customer; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount; IDR - Indonesian Rupiah; All deliveries
Komponen (8): CreateInvoiceForm, arapUi, SettlementForm, CustomerModal, CurrencyRateFields, FilterSelect, StatementsTab, arapSalesUi
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (40):
- Select or type a customer... (bisa nonaktif sesuai kondisi)
- <c.name> Not in customer master yet
- New customer &quot; &quot;
- Close
- Cancel
- Add Item (bisa nonaktif sesuai kondisi)
- Print
- Preview
- Delete (bisa nonaktif sesuai kondisi)
- Save Draft (bisa nonaktif sesuai kondisi)
- Submit for Approval (bisa nonaktif sesuai kondisi)
- View Details / Add Details (bisa nonaktif sesuai kondisi)
- Numbering (bisa nonaktif sesuai kondisi)
- Follow payment terms
- Clear project
- Import from Product (bisa nonaktif sesuai kondisi)
- Remove item (bisa nonaktif sesuai kondisi)
- Add Item Add a line for another product or service. (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Reverse (bisa nonaktif sesuai kondisi)
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
- Save Customer (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Open Journal Preview → /transactions/sales?tab=journal-preview; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:Search name or customer ID...; input:Search product or service...; checkbox; input:INV/YYYY/####; date; input:Head Office; input:e.g. PRJ-001 - ERP Implementation; textarea:Street, district, city, postal code, country; textarea:e.g. Payment by bank transfer to ...; input:Select product/service...; input; number; input:unit; number:0; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; input:0; input:Transfer / cheque number; textarea:ar / e.g. Partial settlement of invoices / e.g. Payment for J; input:Search … number...; checkbox:Select all; checkbox:Select …; label:⟨children⟩; label:Record an unapplied amount ⟨cfg.unappliedHint⟩; input:Auto (CUST-###); input:01.234.567.8-901.000; email:finance@customer.co.id

### `/accounts-receivable/receipts/new` — Edit … / Record …
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Edit … / Record …; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount; IDR - Indonesian Rupiah; All deliveries
Komponen (6): SettlementForm, arapUi, StatementsTab, CurrencyRateFields, FilterSelect, arapSalesUi
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (26):
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Save Draft (bisa nonaktif sesuai kondisi)
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Print (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- Preview
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:0; date; input; input:Transfer / cheque number; textarea:ar / e.g. Partial settlement of invoices / e.g. Payment for J; input:Search … number...; checkbox:Select all; checkbox:Select …; checkbox; label:⟨children⟩; label:Record an unapplied amount ⟨cfg.unappliedHint⟩; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; date:Period start; date:Period end; input:Search …, period...; input:finance@customer.co.id; input:Separate multiple addresses with commas; textarea; label:⟨cfg.party⟩ *; label:Statement Period *; label:Currency; label:To *; label:Save as this customer&apos;s email; label:Cc; label:Subject; label:Message

### `/agentic-ai` — Agentic AI
Grup menu: Management
Komponen (3): AgenticAIView, OfficeScene, AiFace
Tombol/aksi (1):
- Tutup

### `/ai-financial-analyst` — AI Financial Analyst
Grup menu: Intelligence
Judul/seksi di halaman: AI Financial Analyst; New Financial Analysis; Executive Summary; Monthly P&L Trend; Performance Drivers; Investigation: Why is Opex Increasing?; AI Recommendations; AR Aging Distribution; Customer Concentration Risk; High Risk Customer Analysis; Critical Overdue Invoices; Monthly Cash Flow Components
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Why did profit change?; What is driving our expenses?; Which customers have the highest credit risk?; Where are we over budget?; How healthy is our cash position?; Forecast the next quarter.; What is causing margin pressure?; Which vendors have the largest exposure?; Are there unusual journal entries?; What are our biggest financial risks?; What should management focus on this month?; Company; Period; Currency; Branch; Last Updated; Journal Entry; GL Account; Cost Center; Approved By; Posted Date; Total AR; Overdue AR; 90+ Days; DSO; Collection Rate; Bad Debt Exposure; Current AR; Due This Week; Opening Cash (Jan); Operating CF; Investing CF; Financing CF; Net Cash Flow; Closing Cash (Aug); Cash Runway; AR Impact; Anomalies Detected; Total Variance; High Risk Items
Komponen (16): AIAnalystLayout, AIConversationSidebar, AIAnalysisArea, AIContextPanel, NewAnalysisModal, AppIcon, ProfitAnalysis, ARRiskAnalysis, CashFlowAnalysis, QuarterComparison, ExpenseAnomalyAnalysis, APRiskAnalysis, StatusBadge, InteractiveDonutChart, ARAgingChartInner, TransactionsContext
Tombol/aksi (32):
- [ikon Chevron Left]
- New Analysis
- [ikon XMark]
- [label dari data: q.label]
- [label dari data: item.label]
- Start New Analysis
- Save
- Export
- Create Report (→ /reports)
- [label dari data: action.label]
- [ikon Chevron Right]
- AI Confidence
- Financial Health
- Key Risks <keyRisks.length>
- AI Insights <aiInsights.length>
- Analysis Scope
- Analyze
- [label dari data: t.name, t.desc, t.recommended]
- Cancel
- Operating Expenses
- [label dari data: p]
- View in Accounts Payable →
- [label dari data: rec.action]
- View All → (→ /accounts-receivable)
- Collect → (→ /accounts-receivable)
- View All Invoices → (→ /accounts-receivable)
- View Transactions (→ /transactions)
- View Vendor (→ /accounts-payable)
- Investigate
- View All → (→ /accounts-payable)
- Pay → (→ /accounts-payable)
- View All Bills → (→ /accounts-payable)
Isian/filter: text:Search analyses...; text:e.g. What is causing our operating expenses to increase?; label:Custom Question

### `/assets` — Fixed Assets
Grup menu: Assets & Equity
Judul/seksi di halaman: Fixed Assets; Asset Register; Draft Assets
Tab di halaman (termasuk tab di panel detail): Overview; Asset Register; Draft; Depreciation; Disposal; Reports; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Fixed Assets; Accumulated Depreciation; Net Book Value; Additions This Year; Total Assets; Active Assets; Under Construction; Assets Near End of Useful Life; Current Month Depreciation; YTD Depreciation; Pending Depreciation Batches; Posted Depreciation Entries; Pending Disposals; Disposed This Year; Disposal Proceeds; Gain / Loss on Disposal; Assets by Category; Monthly Depreciation; Disposals in Period; Posted Entries; Posted This Month; Total Posted Depreciation; Total Posted Disposals
Komponen (15): FixedAssetsWorkspace, arapUi, moduleUi, OverviewTab, RegisterTab, DepreciationTab, DisposalTab, ReportsTab, PostedTab, DraftTab, AssetFormDrawer, CategoriesDrawer, AssetDetailDrawer, RunDepreciationModal, DisposalFormDrawer
Tombol/aksi (50):
- Run Depreciation (bisa nonaktif sesuai kondisi)
- New Disposal (bisa nonaktif sesuai kondisi)
- Export PDF (bisa nonaktif sesuai kondisi)
- Add Asset (bisa nonaktif sesuai kondisi)
- [label dari data: t.label]
- Today
- Refresh
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- Set up categories
- Review
- Categories
- View All ›
- Open asset
- Export
- Actions
- Open Batch for
- Run Depreciation for (bisa nonaktif sesuai kondisi)
- Reverse Batch
- Edit
- Reject
- Apply Filters
- [label dari data: FORMAT_LABEL[format]] (bisa nonaktif sesuai kondisi)
- View Report
- [label dari data: FORMAT_LABEL[f]] (bisa nonaktif sesuai kondisi)
- Open Journal
- Asset
- Save Draft / Save Asset (bisa nonaktif sesuai kondisi)
- Manage categories
- Accounts Category defaults: / /
- Save Category (bisa nonaktif sesuai kondisi)
- Create from COA (bisa nonaktif sesuai kondisi)
- New Category
- Category is used by assets / Delete (bisa nonaktif sesuai kondisi)
- Post Acquisition Journal
- Adjustment
- Dispose
- Show less / Show all … months
- Post (bisa nonaktif sesuai kondisi)
- Post Adjustment (bisa nonaktif sesuai kondisi)
- Create Draft Batch (bisa nonaktif sesuai kondisi)
- Create & Post (bisa nonaktif sesuai kondisi)
- Save Draft (bisa nonaktif sesuai kondisi)
- Submit for Approval (bisa nonaktif sesuai kondisi)
Link ke halaman lain: View Journal → /reports/general-ledger; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date; label:As of; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; textarea; label:⟨label⟩ ⟨children⟩; input:Search assets by code, name, or keyword...; label:Filters All Draft Pending Approved Rejected Posted Reversed; label:Period –; label:Branch All Branches; label:Category All Categories; label:Location All Locations; label:Format PDF Excel CSV; input:Search by journal no., asset code, asset name, or reference...; label:Posting Date All Dates This Month This Quarter This Year; label:Transaction Type All Types; label:Asset Category All Categories; label:Status All Statuses Posted Reversed; input:Search drafts by code, name, category...; checkbox; input:Auto; input:e.g. Toyota Innova B 1234 CD; number; number:0; input:e.g. Jakarta HQ; input; label:Draft

### `/audit` — Audit
Grup menu: Intelligence
Judul/seksi di halaman: Risk Matrix; Audit Center; Audit Progress; Audit Findings; Audit Activity Timeline; Audit Trail; New Audit Finding
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Audit Completion; Open Findings; High Risk; Pending Evidence; Adjustments; Controls Tested
Tombol/aksi (8):
- ✓ Done
- AUD-
- New Finding
- Export
- [label dari data: stage.label, stage.date]
- Filter
- Cancel
- Saving... / Create Finding (submit form; bisa nonaktif sesuai kondisi)
Isian/filter: file; text:Search findings...; text:Filter by user, module, or action...; textarea; input; number; select; date; label:Description *; label:Area; label:Account; label:Financial Impact; label:Risk; label:Assigned To; label:Due Date; label:Likelihood (1-5); label:Impact (1-5); label:Root Cause; label:Recommendation

### `/budget-forecast` — Budget & Forecast
Grup menu: Planning
Judul/seksi di halaman: Budget & Forecast; Financial Plan; Financial Performance: Budget vs Actual vs Forecast; Monthly Budget Performance; Budget Variance Analysis; What Is Driving the Budget Variance?; Scenario Planning; Forecast Assumptions; Budget Allocation; Forecast Risks; AI Planning Insights
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Budget Achievement; Forecast vs Budget; Actual Revenue; Forecast Revenue; Forecast Confidence; Expected Collections; CapEx Budget; Revenue Budget; EBITDA Budget; Net Profit Budget; COGS Budget; OpEx Budget; Gross Profit Budget; Revenue Full-Year Forecast; Total Budget Variance; Revenue; EBITDA; Net Profit; Ending Cash; Revenue Growth; COGS %; Payroll Growth; OpEx Growth; Collection Rate; Tax Rate; CapEx (Rp M); Interest Expense
Komponen (17): BudgetForecastPage, BudgetHeader, PlanningStatusHero, BudgetKPICards, BudgetVsActualChart, MonthlyBudgetTable, VarianceAnalysis, VarianceWaterfall, ScenarioPlanning, ForecastAssumptions, BudgetAllocation, ForecastRisks, BudgetAllInsights, AppIcon, BudgetChartInner, WaterfallChartInner, TransactionsContext
Tombol/aksi (24):
- [label dari data: branch]
- [label dari data: b]
- [label dari data: scenario]
- [label dari data: s]
- [label dari data: v]
- Export Plan
- [label dari data: m]
- [label dari data: h]
- Export
- impact / By Impact / By Variance
- Expand
- [label dari data: item.label]
- New Scenario
- Menyimpan… / Simpan (bisa nonaktif sesuai kondisi)
- Batal
- <name> <s.description> Revenue Growth <s.revenueGrowth> % Confidence <s.confidence> %
- Hapus skenario
- department / By Department / By Category
- View By Category
- Less / Details
- Analyze (→ /ai-financial-analyst?analysis=${risk.category.toLowerCase().replace(/\s+/g, )
- Refresh Insights
- Analyze (→ /ai-financial-analyst?analysis=budget-forecast)
- View Data
Isian/filter: input:Filter month...; text:Nama skenario; number:Revenue growth %; number:COGS %; number:OpEx growth %; number:Tax rate %; number

### `/clients` — Clients
Grup menu: Management
Judul/seksi di halaman: Edit Client / Add New Client; Clients; Portfolio Health Distribution
Tab di halaman (termasuk tab di panel detail): Overview; Financial; Health Score; Activity; AI Insights
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Revenue; Net Profit; Cash; Accounts Receivable; Accounts Payable; Gross Margin; Total Clients; Healthy; Stable; Needs Attention; Critical; Avg Health Score
Komponen (2): ClientsPageClient, TabNav
Tombol/aksi (21):
- [ikon X]
- Full AI Analysis
- Generate Report
- View Full Profile
- Reports
- Tax
- Menu client
- Edit
- Delete
- Change logo / Upload logo (bisa nonaktif sesuai kondisi)
- Remove (bisa nonaktif sesuai kondisi)
- Cancel (bisa nonaktif sesuai kondisi)
- Menyimpan... / Save Changes / Add Client (submit form; bisa nonaktif sesuai kondisi)
- Import
- Export
- Add Client
- Portfolio view
- Table view
- [ikon Chevron Right]
- [label dari data: p]
- [label dari data: inner]
Isian/filter: file; input:PT Contoh Sejahtera; select; input; input:+62 21 5555 0000; email:contact@company.co.id; input:00.000.000.0-000.000; text:Search clients…; label:Client Code; label:Company Name *; label:Industry *; label:Status; label:Contact Name; label:Contact Phone; label:Contact Email; label:NPWP; label:Address

### `/coa` — Chart of Accounts
Grup menu: Management
Judul/seksi di halaman: Chart of Accounts
Komponen (1): CoaPageClient
Tombol/aksi (12):
- Refresh (bisa nonaktif sesuai kondisi)
- Export (bisa nonaktif sesuai kondisi)
- [label dari data: label, n]
- Clear search
- [label dari data: s]
- All <accounts.length>
- [label dari data: counts[c]]
- Add to … / Select a client first (bisa nonaktif sesuai kondisi)
- Delete
- Clear filters
- Clear
- Adding… / Add to … (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Opening Balances → /coa/opening-balances; New Account → /coa/new…; [ikon Pencil] → /coa/…/edit…
Isian/filter: input:Search ACC No or account name…; checkbox:Select all; checkbox:Select …

### `/coa/:id/edit` — Account not found
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Account not found
Komponen (1): CoaFormPage
Tombol/aksi (4):
- DEBIT / Debit / Credit
- [label dari data: title, hint] (bisa nonaktif sesuai kondisi)
- Save changes / Create account (submit form; bisa nonaktif sesuai kondisi)
- Save & add another (bisa nonaktif sesuai kondisi)
Isian/filter: input:Legacy code; input:11100001; input:KAS KASIR; input:CURRENT ASSET; input:CASH & CASH EQUIVALENTS; input:std_asset_current_cash_bank; input:Cash and cash equivalents; input:Assets > Current assets > Cash and cash equivalents; textarea:What is this account used for?; label:Account code; label:ZAFEB code *; label:Account name *; label:Classification *; label:Normal balance; label:Account head; label:Account sub; label:Standard account code; label:IFRS taxonomy reference; label:International standard group (IFRS-aligned); label:Active Inactive accounts are hidden from pickers.

### `/coa/new` — Account not found
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Account not found
Komponen (1): CoaFormPage
Tombol/aksi (4):
- DEBIT / Debit / Credit
- [label dari data: title, hint] (bisa nonaktif sesuai kondisi)
- Save changes / Create account (submit form; bisa nonaktif sesuai kondisi)
- Save & add another (bisa nonaktif sesuai kondisi)
Isian/filter: input:Legacy code; input:11100001; input:KAS KASIR; input:CURRENT ASSET; input:CASH & CASH EQUIVALENTS; input:std_asset_current_cash_bank; input:Cash and cash equivalents; input:Assets > Current assets > Cash and cash equivalents; textarea:What is this account used for?; label:Account code; label:ZAFEB code *; label:Account name *; label:Classification *; label:Normal balance; label:Account head; label:Account sub; label:Standard account code; label:IFRS taxonomy reference; label:International standard group (IFRS-aligned); label:Active Inactive accounts are hidden from pickers.

### `/coa/opening-balances` — Opening Balances
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Opening Balances
Komponen (2): OpeningBalanceListClient, obUi
Tombol/aksi (5):
- Refresh (bisa nonaktif sesuai kondisi)
- all / All years / FY …
- — Choose a suspense account — (bisa nonaktif sesuai kondisi)
- Clear selection
- [label dari data: a.account_name]
Link ke halaman lain: Chart of Accounts → /coa; New opening balance → /coa/opening-balances/new; As of · Start of year / Mid-year cut-off Debit Credit ⟨s.line_count⟩ account → /coa/opening-balances/…
Isian/filter: select; label:Select client; input:Search account code or name...

### `/coa/opening-balances/:id` — Opening balance not found
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Opening balance not found; Opening Balance; Setup required
Komponen (4): OpeningBalanceEditorClient, OpeningBalanceImportTab, importUi, obUi
Tombol/aksi (15):
- Delete (bisa nonaktif sesuai kondisi)
- Revise (bisa nonaktif sesuai kondisi)
- Lock (bisa nonaktif sesuai kondisi)
- Unlock (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Clear search
- Export (bisa nonaktif sesuai kondisi)
- Save draft (bisa nonaktif sesuai kondisi)
- Approve (bisa nonaktif sesuai kondisi)
- Import (bisa nonaktif sesuai kondisi)
- Download Template (bisa nonaktif sesuai kondisi)
- Close
- — Choose a suspense account — (bisa nonaktif sesuai kondisi)
- Clear selection
- [label dari data: a.account_name]
Link ke halaman lain: Back to opening balances → /coa/opening-balances; Chart of Accounts → /coa; Opening balances → /coa/opening-balances; [ikon ArrowLeft] → /coa/opening-balances; ⟨latest.file_name⟩ · ⟨latest.total_rows⟩ row · … error… → /coa/opening-balances/…/imports/…/…; Monitor → /coa/opening-balances/…/imports/…; ⟨s.module_label⟩ → /coa/opening-balances/…/imports/…
Isian/filter: date; input:Audited balance sheet; input:Optional; input:Search ACC No, account name, head, or sub…; input:0; label:Cut-off date; label:Suspense account; label:Reference; label:Notes; file; input:Search account code or name...

### `/coa/opening-balances/:id/imports/:module` — Import module not found
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Import module not found
Komponen (3): ImportMonitorClient, importUi, obUi
Tombol/aksi (5):
- Refresh (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- — Choose a suspense account — (bisa nonaktif sesuai kondisi)
- Clear selection
- [label dari data: a.account_name]
Link ke halaman lain: Back to opening balance → /coa/opening-balances/…; Chart of Accounts → /coa; Opening balances → /coa/opening-balances; FY … · … → /coa/opening-balances/…; [ikon ArrowLeft] → /coa/opening-balances/…; ⟨s.module_label⟩ → /coa/opening-balances/…/imports/…
Isian/filter: input:Search account code or name...

### `/coa/opening-balances/:id/imports/:module/:batchId` — Import batch not found
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Import batch not found; Reject import batch
Komponen (3): ImportBatchReviewClient, importUi, obUi
Tombol/aksi (11):
- Cancel batch (bisa nonaktif sesuai kondisi)
- Submit for approval (bisa nonaktif sesuai kondisi)
- Reject (bisa nonaktif sesuai kondisi)
- Approve all / Approve selected (…) (bisa nonaktif sesuai kondisi)
- Clear search
- [label dari data: label]
- Select all data (bisa nonaktif sesuai kondisi)
- Clear selection (bisa nonaktif sesuai kondisi)
- Close (bisa nonaktif sesuai kondisi)
- — Choose a suspense account — (bisa nonaktif sesuai kondisi)
- [label dari data: a.account_name]
Link ke halaman lain: Back to opening balance → /coa/opening-balances/…; Opening balances → /coa/opening-balances; FY … · … / Opening balance → /coa/opening-balances/…; ⟨s.module_label⟩ → /coa/opening-balances/…/imports/…
Isian/filter: input:Search rows or messages…; textarea:Reason for rejection; checkbox:Select all rows; checkbox:Select row …; input:Search account code or name...

### `/coa/opening-balances/new` — New Opening Balance
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: New Opening Balance; Period; Branch; Suspense & reference
Komponen (2): OpeningBalanceNewClient, obUi
Tombol/aksi (9):
- [ikon Minus]
- [ikon Plus]
- [label dari data: judul, hint]
- [label dari data: label]
- [label dari data: b]
- Continue to balances (submit form; bisa nonaktif sesuai kondisi)
- — Choose a suspense account — (bisa nonaktif sesuai kondisi)
- Clear selection
- [label dari data: a.account_name]
Link ke halaman lain: Chart of Accounts → /coa; Opening balances → /coa/opening-balances; [ikon ArrowLeft] → /coa/opening-balances; Cancel → /coa/opening-balances
Isian/filter: date; input:e.g. OL; input:Audited balance sheet 2024; input:Optional; label:Fiscal year; label:Cut-off; label:Cut-off date; label:Branch name; label:Suspense account (optional now); label:Reference; label:Notes; input:Search account code or name...

### `/documents` — Documents
Grup menu: Management
Judul/seksi di halaman: Documents
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Type; Company; Related Record; Uploaded By; Date; File Size; Total Documents; Processed; Pending Review; Needs Attention
Komponen (1): DocumentsPageClient
Tombol/aksi (16):
- [ikon X]
- Open Document
- review / Reviewing… / Review
- Investigate
- <item.icon> Done ✓
- Preview
- Download
- Delete
- Upload
- Menyimpan… / Browse Files (bisa nonaktif sesuai kondisi)
- Cancel (bisa nonaktif sesuai kondisi)
- [label dari data: folder.name, folder.count]
- [ikon List]
- [ikon Layout Grid]
- Upload Document
- [label dari data: p]
Isian/filter: select:Ubah status dokumen; file; text:Search documents…; select

### `/equity` — Equity
Grup menu: Assets & Equity
Judul/seksi di halaman: Equity
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Branch; Currency; TOTAL EQUITY; PAID-IN CAPITAL; RETAINED EARNINGS; CURRENT YEAR PROFIT; OTHER EQUITY; EQUITY GROWTH
Komponen (16): EquityContent, PageHeader, BalanceValidationCard, AppIcon, TransactionsContext, EquityKPIGrid, EquityMovementChart, EquityTrendChart, EquityClassification, EquityTransactions, RetainedEarningsAnalysis, EquityAllInsights, FinancialKPICard, FinancialStatusBadge, EmptyState, FinancialInsightCard
Tombol/aksi (10):
- Export
- Refresh
- [label dari data: selectedPeriod]
- [label dari data: p]
- [label dari data: filterValues[f.key]]
- [label dari data: opt]
- [label dari data: v]
- View journal entry
- [label dari data: action.label]
- Analyze
Isian/filter: input:Search transactions...; select

### `/exchange-rates` — Exchange Rates
Grup menu: Management
Judul/seksi di halaman: Exchange Rates; Rate history
Komponen (3): ExchangeRatesClient, arapUi, moduleUi
Tombol/aksi (20):
- Refresh
- Fetch rates
- Paste import
- Add rate
- Clear
- Edit
- Delete
- Prev (bisa nonaktif sesuai kondisi)
- Next (bisa nonaktif sesuai kondisi)
- Cancel
- Save (bisa nonaktif sesuai kondisi)
- Close
- Import rate (bisa nonaktif sesuai kondisi)
- Fetch (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: select:Currency; select:Rate type; select:Source; date:From date; date:To date; input; select; date; number; input:e.g. BI JISDOR, KMK 123/2026; textarea; textarea:USD\t2026-11-12\t16000\nSGD\t2026-11-12\t11750.5\nUSD\t2026-1; checkbox; label:⟨c.code⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; label:⟨label⟩ ⟨children⟩

### `/financial-analytics` — Financial Analytics
Grup menu: Planning
Judul/seksi di halaman: Financial Analytics; Profitability Analysis; Liquidity Analysis; solvency / Solvency Analysis / Operational Efficiency; Growth Analysis; Revenue Drivers; Expense Drivers; Customer Financial Analysis; Financial Performance Matrix; Financial Trend Explorer; Financial Anomalies; AI Financial Insights
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Revenue Growth; Gross Margin; EBITDA Margin; Net Margin; Current Ratio; Quick Ratio; Debt-to-Equity; Return on Equity; Current; Internal Target; Cash Ratio; Working Capital; Cash Runway; Debt Ratio; Interest Coverage; Total Liabilities; Asset Turnover; DSO; DPO; Cash Conv. Cycle; Gross Profit Growth; EBITDA Growth; Net Profit Growth; Asset Growth; Equity Growth; Customer; Revenue; Growth; Outstanding AR; Collection Rate; Contribution %; Profitability
Komponen (23): FinancialAnalyticsPage, AnalyticsHeader, FinancialHealthHero, AnalyticsKPICards, ProfitabilityAnalytics, LiquidityAnalytics, SolvencyEfficiencyAnalytics, GrowthAnalytics, RevenueDrivers, ExpenseDrivers, CustomerAnalytics, PerformanceMatrix, TrendExplorer, AnomalyDetection, FinancialAIInsights, AppIcon, HealthRadarInner, ProfitabilityChartInner, LiquidityChartInner, SolvencyChartInner, GrowthChartInner, TrendExplorerChartInner, TransactionsContext
Tombol/aksi (17):
- [label dari data: branch]
- [label dari data: b]
- vs <comparison>
- [label dari data: c]
- Export
- Drill Down
- [label dari data: m]
- solvency / Solvency / Efficiency
- Drill Down →
- [label dari data: p]
- [label dari data: h]
- Analyze
- View Transactions
- View Journal Entries
- Refresh
- Open AI Analyst
- Open in P&L
Isian/filter: input:Search customers...

### `/financial-statements` — Financial Statements
Grup menu: Financial
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Monthly; Quarterly; Year to date; Full year; Custom range; No comparison; Previous period; Same period last year; Custom period
Komponen (3): FsHubClient, FsShell, PeriodPicker
Tombol/aksi (1):
- Apply (submit form; bisa nonaktif sesuai kondisi)
Link ke halaman lain: FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing
Isian/filter: select; date; label:⟨label⟩ ⟨children⟩

### `/financial-statements/balance-sheet` — Balance Sheet
Grup menu: Financial
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Balance Sheet (Default); Balance Sheet Trend; Balance Sheet Comparison; Assets vs Liabilities; Total Assets; Total Liabilities; Total Equity; Assets; Liabilities & Equity; vs Previous Quarter; vs Same Quarter Last Year; vs Previous Year End; Same date last year; Previous year end; Previous month end
Komponen (10): BalanceSheetClient, FsShell, BsDefaultView, BsTrendView, BsComparisonView, BsAssetsLiabView, BsMono, CheckBanner, DownloadMenu, BsToolbar
Tombol/aksi (9):
- Collapse accounts / Expand accounts
- [label dari data: current?.label]
- [label dari data: o.label]
- [label dari data: label]
- Print
- <journals.length> unbalanced journal
- <warnings.length> account mapping warning — review in the Mapping tab
- Download (bisa nonaktif sesuai kondisi)
- [label dari data: it.label]
Link ke halaman lain: FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing
Isian/filter: date; label:From to; label:As of; label:Year; label:Show amount in millions; label:Fiscal Year; label:Comparison Basis; label:Compare with

### `/financial-statements/cash-flow` — Cash Flow
Grup menu: Financial
Judul/seksi di halaman: Cash Flow Statement ( direct / Direct / Indirect Method)
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Cash Flow Statement (Direct Method); Cash Flow Statement (Indirect Method); Monthly; Quarterly; Annual; Direct Method; Indirect Method; Year to date; Full year; Custom range; No comparison; Previous period; Same period last year; Custom period
Komponen (8): CashFlowClient, FsShell, CashFlowView, CheckBanner, PeriodPicker, BsUi, BsToolbar, DownloadMenu
Tombol/aksi (9):
- [label dari data: o.label]
- Collapse accounts / Expand accounts
- [label dari data: o.l]
- <journals.length> unbalanced journal
- <warnings.length> account mapping warning — review in the Mapping tab
- Apply (submit form; bisa nonaktif sesuai kondisi)
- Print
- Download (bisa nonaktif sesuai kondisi)
- [label dari data: it.label]
Link ke halaman lain: FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing; Statement Mapping → /financial-statements/mapping; Map them → /financial-statements/mapping; [ikon ExternalLink] → /financial-statements/profit-loss
Isian/filter: select:View; date:From; date:To; select; select:Unit; label:Chart Type Column & Line Line; label:Show Comparison; date; label:⟨label⟩ ⟨children⟩

### `/financial-statements/changes-in-equity` — Statement of Changes in Equity
Grup menu: Financial
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Monthly; Quarterly; Year to date; Full year; Custom range; No comparison; Previous period; Same period last year; Custom period
Komponen (5): EquityClient, FsShell, DownloadMenu, CheckBanner, PeriodPicker
Tombol/aksi (5):
- Download (bisa nonaktif sesuai kondisi)
- [label dari data: it.label]
- <journals.length> unbalanced journal
- <warnings.length> account mapping warning — review in the Mapping tab
- Apply (submit form; bisa nonaktif sesuai kondisi)
Link ke halaman lain: FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing
Isian/filter: select; date; label:⟨label⟩ ⟨children⟩

### `/financial-statements/mapping` — Statement Mapping
Grup menu: Financial
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Monthly; Quarterly; Year to date; Full year; Custom range; No comparison; Previous period; Same period last year; Custom period
Komponen (3): MappingClient, FsShell, PeriodPicker
Tombol/aksi (6):
- Reset to default (bisa nonaktif sesuai kondisi)
- Cancel
- Apply defaults (bisa nonaktif sesuai kondisi)
- Re-apply & overwrite (bisa nonaktif sesuai kondisi)
- Edit
- Apply (submit form; bisa nonaktif sesuai kondisi)
Link ke halaman lain: FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing
Isian/filter: input:Default: …; input:Default: … / e.g. (Increase)/decrease in trade receivables; input:Search code, name or line; checkbox; label:Only accounts with warnings; select; date; label:⟨label⟩ ⟨children⟩

### `/financial-statements/notes` — Notes to Financial Statements
Grup menu: Financial
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Monthly; Quarterly; Year to date; Full year; Custom range; No comparison; Previous period; Same period last year; Custom period
Komponen (3): NotesClient, FsShell, PeriodPicker
Tombol/aksi (16):
- Cancel
- Save (bisa nonaktif sesuai kondisi)
- [ikon X]
- final / Reopen draft / Mark final (bisa nonaktif sesuai kondisi)
- Rename
- Delete / Hide (bisa nonaktif sesuai kondisi)
- Audit trail
- Edit narrative
- Use standard text (bisa nonaktif sesuai kondisi)
- Reset to template (bisa nonaktif sesuai kondisi)
- Remove override (bisa nonaktif sesuai kondisi)
- Override
- [label dari data: n.title]
- Add note (bisa nonaktif sesuai kondisi)
- PDF
- Apply (submit form; bisa nonaktif sesuai kondisi)
Link ke halaman lain: Mapping tab → /financial-statements/mapping; ⟨n.no⟩ . ⟨n.title⟩ → #note-…; Map them → /financial-statements/mapping; FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing
Isian/filter: input; input:e.g. Audit adjustment not yet journaled; textarea; input:e.g. Commitments and Contingencies; input:e.g. commitments; select; date; label:⟨label⟩ ⟨children⟩

### `/financial-statements/profit-loss` — Profit & Loss
Grup menu: Financial
Judul/seksi di halaman: Profit & Loss
Tab di halaman (termasuk tab di panel detail): Balance Sheet; Profit & Loss; Changes in Equity; Cash Flow; Notes (CALK); Mapping; General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Profit & Loss (Default); Profit & Loss Trend; Profit & Loss Comparison; Gross Profit vs Net Profit; Net Profit; Operating Profit; Gross Profit; Revenue; vs Previous Quarter; vs Same Quarter Last Year; Monthly; Quarterly; Year to date; Full year; Custom range; No comparison; Previous period; Same period last year; Custom period
Komponen (12): ProfitLossClient, FsShell, PlDefaultView, PlTrendView, PlComparisonView, PlGrossNetView, PlUi, CheckBanner, PeriodPicker, BsUi, BsToolbar, DownloadMenu
Tombol/aksi (7):
- Collapse accounts / Expand accounts
- <journals.length> unbalanced journal
- <warnings.length> account mapping warning — review in the Mapping tab
- Apply (submit form; bisa nonaktif sesuai kondisi)
- Print
- Download (bisa nonaktif sesuai kondisi)
- [label dari data: it.label]
Link ke halaman lain: FY ⟨last.fiscal_year⟩ closed · locked through → /year-end-closing
Isian/filter: select:View; month; select; label:Month; label:Year; label:Show amount in millions; label:Fiscal Year; label:Comparison Basis; label:Period Full year Year to date; date; label:⟨label⟩ ⟨children⟩

### `/fx-revaluation` — FX Revaluation
Grup menu: Financial
Judul/seksi di halaman: Open foreign-currency items; Journal to post; Revaluation history; FX Revaluation
Komponen (3): FxRevaluationClient, arapSalesUi, PageHeading
Pembatasan hak akses di halaman ini: level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (11):
- Preview (bisa nonaktif sesuai kondisi)
- Retry (bisa nonaktif sesuai kondisi)
- Post revaluation (bisa nonaktif sesuai kondisi)
- Refresh
- Cancel
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date; input; input:e.g. November closing; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; label:⟨label⟩ ⟨children⟩

### `/fx-transfers` — FX Transfers
Grup menu: Financial
Judul/seksi di halaman: Cash and bank accounts; Transactions without a foreign amount; New currency transfer; Transfer history; FX Transfers
Komponen (3): FxTransfersClient, arapSalesUi, PageHeading
Pembatasan hak akses di halaman ini: level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (15):
- Refresh accounts
- Retry
- Edit / Set as foreign
- Remove
- Save (bisa nonaktif sesuai kondisi)
- Cancel
- Preview (bisa nonaktif sesuai kondisi)
- Post transfer (bisa nonaktif sesuai kondisi)
- Refresh
- Reverse
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date; input; input:0.00; select; input:master rate; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; label:⟨label⟩ ⟨children⟩

### `/inventory` — Inventory
Grup menu: Assets & Equity
Judul/seksi di halaman: Inventory
Tab di halaman (termasuk tab di panel detail): Overview; Item List; Stock Movement; Adjustments; Transfer; Reports
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Items; Total Stock Value; Low Stock Items; Out of Stock
Komponen (13): InventoryWorkspace, arapUi, moduleUi, OverviewTab, ItemListTab, MovementTab, DocumentsTab, ReportsTab, ItemFormDrawer, ItemDetailDrawer, SetupDrawer, DocumentFormDrawer, DocumentDrawer
Tombol/aksi (53):
- Warehouses & Categories (bisa nonaktif sesuai kondisi)
- New Document (bisa nonaktif sesuai kondisi)
- [label dari data: t.label]
- Refresh
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- Open setup
- Reset
- Import
- Export
- Add Item
- View
- Edit
- More
- Download Template
- Import Items (bisa nonaktif sesuai kondisi)
- Choose a file
- [label dari data: l]
- Record Stock
- Open document
- Create Transfer / Adjustment
- [label dari data: r.label]
- Generate (bisa nonaktif sesuai kondisi)
- Export PDF (bisa nonaktif sesuai kondisi)
- Export Excel (bisa nonaktif sesuai kondisi)
- Save Item (bisa nonaktif sesuai kondisi)
- Manage categories
- Goods Receipt
- Goods Issue
- Adjust
- Save Warehouse (bisa nonaktif sesuai kondisi)
- New Warehouse
- Save Category (bisa nonaktif sesuai kondisi)
- Create from COA (bisa nonaktif sesuai kondisi)
- New Category
- [ikon Pencil]
- [ikon Trash2] (bisa nonaktif sesuai kondisi)
- Save Draft (bisa nonaktif sesuai kondisi)
- Save & Post (bisa nonaktif sesuai kondisi)
- Create one first.
- Counted quantity (stock count)
- Quantity change (+/−)
- Add Line
- Remove line
- Delete (bisa nonaktif sesuai kondisi)
- Post (bisa nonaktif sesuai kondisi)
- Void
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date; label:Per; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; textarea; label:⟨label⟩ ⟨children⟩; input:Search item code, name, barcode...; file; checkbox; label:Category All; label:Status All; label:Location All; label:Update items whose code already exists; label:Period –; label:Item All; label:Transaction Type All; input:Search reference no, item, remark...; label:From Location / Location All; label:To Location All; label:Per Date; label:Item Select item; input:Auto; input; number; input:e.g. Main Warehouse; input:e.g. Raw Materials; label:Active

### `/liabilities` — Liabilities
Grup menu: Assets & Equity
Judul/seksi di halaman: Liabilities; Liability Composition
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Branch; Currency; Liability Type; Status; Due Date; TOTAL LIABILITIES; CURRENT LIABILITIES; NON-CURRENT LIABILITIES; ACCOUNTS PAYABLE; TAX PAYABLE; SHORT-TERM DEBT; LONG-TERM DEBT; TOTAL DEBT; Total Debt; Short-Term Debt; Long-Term Debt; Debt-to-Equity; Interest Coverage; Interest Expense
Komponen (16): LiabilitiesContent, PageHeader, BalanceValidationCard, AppIcon, TransactionsContext, LiabilitiesKPIGrid, LiabilitiesChartsSection, DebtAnalysisSection, LiabilityDueSchedule, LiabilityTransactions, LiabilitiesAllInsights, FinancialKPICard, InteractiveDonutChart, FinancialStatusBadge, EmptyState, FinancialInsightCard
Tombol/aksi (14):
- Export
- Refresh
- [label dari data: selectedPeriod]
- [label dari data: p]
- [label dari data: filterValues[f.key]]
- [label dari data: opt]
- [label dari data: v]
- [label dari data: s]
- View details
- [ikon Chevron Left] (bisa nonaktif sesuai kondisi)
- [ikon Chevron Right] (bisa nonaktif sesuai kondisi)
- View journal entry
- [label dari data: action.label]
- Analyze
Isian/filter: input:Search obligations...; input:Search transactions...

### `/login` — Accounting that keeps your books clear and current.
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Accounting that keeps your books clear and current.; Welcome back
Komponen (4): LoginForm, AppLogo, AppIcon, AppImage
Tombol/aksi (1):
- Hide password / Show password
Isian/filter: input:Enter your username; text / password:Enter your password; label:Username; label:Password

### `/memori-ai` — Memori AI
Grup menu: Overview
Judul/seksi di halaman: Memori AI
Komponen (1): MemoriAIView
Tombol/aksi (8):
- ingatan / Ingatan / Percakapan
- Batal / + Tambah informasi
- Simpan (bisa nonaktif sesuai kondisi)
- Batal
- Edit
- Nonaktifkan / Aktifkan
- Hapus
- suara / Suara / Zafeb AI (kosong)
Isian/filter: input:Cari ingatan…; select; textarea:Tulis satu informasi, mis. “PT Maju Jaya menutup buku setiap ; input:Klien terkait (opsional); textarea

### `/payroll` — Payroll
Grup menu: Management
Judul/seksi di halaman: Payroll
Tab di halaman (termasuk tab di panel detail): Overview; Employees; Payroll Run; Tax & BPJS; Settings; PPh Pasal 21; BPJS; Rekap Tahunan (1721-A1)
Komponen (13): PayrollContent, TabNav, PayrollOverview, EmployeesTab, PayrollRunTab, TaxBpjsTab, PayrollSettingsTab, KpiCard, EmptyState, payrollUi, PayrollCharts, StatusBadge, AppIcon
Tombol/aksi (27):
- Coba lagi
- [label dari data: inner]
- Muat data contoh
- [label dari data: a.text]
- Tambah Karyawan
- Edit
- Hapus
- Batal
- Menyimpan… / Simpan (bisa nonaktif sesuai kondisi)
- Payroll Run Baru
- Tarik ulang master
- Setujui Payroll
- Kembalikan ke Draft
- Tandai Sudah Dibayar
- Batalkan Pembayaran
- Rekap CSV
- File Transfer Bank
- Sembunyikan / Lihat Jurnal
- Cetak slip gaji
- Memproses… / Ya, Kembalikan (bisa nonaktif sesuai kondisi)
- Buat Payroll
- [label dari data: x.label]
- Buka Gembok / Kunci Pengaturan
- Kembalikan default
- Simpan Pengaturan
- [label dari data: action.label]
- Close
Isian/filter: input:Cari nama / NIP...; select; input; date; checkbox; label:⟨label⟩; textarea:Contoh: salah input nominal bonus Hendra; month; label:Alasan (wajib, minimal 5 karakter); label:Periode (bulan); label:Tanggal pembayaran; number; label:Tarif +20% untuk karyawan tanpa NPWP; label:⟨label⟩ ⟨children⟩

### `/reports` — Reports
Grup menu: Management
Judul/seksi di halaman: Reports
Tab di halaman (termasuk tab di panel detail): Business Overview; Sales; Purchases; Inventory; Fixed Assets; Banking; Tax; Production
Komponen (4): ReportsCatalog, TabNav, moduleUi, arapUi
Tombol/aksi (12):
- Remove … from favorites / Add … to favorites
- Export Catalog
- My Favorites ( <favorites.length> )
- [label dari data: inner]
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: select:Company; select:Period; label:Company; label:Period; select; date; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/reports/general-ledger` — General Ledger
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: General Ledger
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): This Month; Last Month; This Quarter; Last Quarter; This Year; Last Year; Custom; Accounts with transactions; Accounts with balance or transactions; All accounts; Selected accounts
Komponen (2): GeneralLedgerClient, PurchaseKpiTile
Tombol/aksi (10):
- [ikon Chevron Down]
- [label dari data: o.label]
- [label dari data: a.account_name]
- Clear
- <account.account_name> … transaction… / No transactions ytd / YTD since … / Monthly balanc (bisa nonaktif sesuai kondisi)
- Download (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Reset
- Apply Filter (submit form; bisa nonaktif sesuai kondisi)
- Collapse all / Expand all (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Reports → /reports
Isian/filter: input:Search code or name; date; input:Find account; label:Period; label:Start Date; label:End Date; label:Include Account

### `/settings` — Settings
Grup menu: Management

### `/settings/account-mapping` — Account mapping
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Account mapping
Komponen (1): AccountMappingSettings
Tombol/aksi (8):
- Lock all mapped (bisa nonaktif sesuai kondisi)
- Unlock all (bisa nonaktif sesuai kondisi)
- <g.label> <isi> / <g.items.length> mapped
- Unlock / Lock (bisa nonaktif sesuai kondisi)
- Reset (bisa nonaktif sesuai kondisi)
- Save changes (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.account_name, o.account_classification] (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Chart of Accounts → /coa
Isian/filter: input:Search account no. or name…; label:⟨it.label⟩

### `/settings/company` — /settings/company
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Company name; Client code; Legal entity type; Industry; Business classification (KLU); NPWP; Deed / NIB number; VAT status; PIC name; PIC position; Email; Office phone; Mobile / WhatsApp; Street address; City; Province; Postal code; Fiscal year starts; Default currency; Financial health; Responsible accountant; Engagement start
Komponen (1): CompanySettings
Tombol/aksi (6):
- Change logo
- Remove logo
- Edit company
- Cancel (bisa nonaktif sesuai kondisi)
- Save changes (bisa nonaktif sesuai kondisi)
- [label dari data: l]
Isian/filter: file; textarea; date; select; email / text; label:⟨fld.label⟩

### `/settings/product` — Goods & Services
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Goods & Services; Basic setting; Subfeature settings
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Stock info on sales & purchases; Product variant
Komponen (1): ProductSettings
Tombol/aksi (9):
- Clear search
- Add
- Edit
- Delete
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- Close
- Cancel (bisa nonaktif sesuai kondisi)
- Save (submit form; bisa nonaktif sesuai kondisi)
Isian/filter: input:Search ……; input; number; checkbox; label:⟨column⟩ *; label:Amount; label:⟨f.label⟩ ⟨f.hint⟩

### `/settings/purchase` — /settings/purchase
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Activate supplier in Purchase Request; Shipping; Discount; Discount per lines; Deposit
Komponen (1): PurchaseSettings
Tombol/aksi (2):
- Reset (bisa nonaktif sesuai kondisi)
- Save changes (bisa nonaktif sesuai kondisi)
Isian/filter: select; checkbox; textarea:e.g. Please deliver to our main warehouse during working hour; label:Preferred purchase term; label:⟨f.label⟩ ⟨f.hint⟩

### `/settings/users` — /settings/users
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Komponen (1): UserManagement
Tombol/aksi (4):
- [label dari data: l]
- Clear search
- Refresh (bisa nonaktif sesuai kondisi)
- Clear filters
Isian/filter: input:Search name or username…; select

### `/tax-compliance` — Tax Compliance
Grup menu: Planning
Judul/seksi di halaman: Tax Compliance; Report Preview
Tab di halaman (termasuk tab di panel detail): Overview; Tax Ledger; PPh; VAT; Payments; Reconciliation; Exceptions; Reports
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Tax Base (DPP); Total PPh Payable; VAT Output; VAT Input; Tax Paid; Unpaid Tax; Unreported Returns; Total Tax Records; Total DPP (Tax Base); Total Tax Amount; Unreported Tax; Total DPP; Paid This Period; Unpaid; Reported; Needs Review; Output VAT; Input VAT; Net VAT Position; e-Faktur Matched; Unmatched VAT; Draft Returns; Total Tax Due; Total Paid; Overdue Tax; Upcoming Due; Payment Success Rate; Unallocated Payments; Reconciled Amount; Unreconciled Amount; Matched Tax Items; Difference Count; Last Reconciliation Date; Total Exceptions; High Risk; Medium Risk; Overdue Review; Resolved This Month; Estimated Exposure
Komponen (13): TaxWorkspace, arapUi, moduleUi, OverviewTab, LedgerTab, PphTab, VatTab, PaymentsTab, ReconciliationTab, ExceptionsTab, ReportsTab, TaxSettingsDrawer, taxUi
Tombol/aksi (34):
- Tax Accounts (bisa nonaktif sesuai kondisi)
- Sync Transactions (bisa nonaktif sesuai kondisi)
- [label dari data: t.label]
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- View Details →
- View All →
- [label dari data: e.reason]
- Add Adjustment
- Export
- Record Tax Payment
- Actions
- Pay
- Update
- Save Payment (bisa nonaktif sesuai kondisi)
- Create Cash & Bank payment
- Record only
- Save (bisa nonaktif sesuai kondisi)
- Run Reconciliation (bisa nonaktif sesuai kondisi)
- Review
- Reset
- Add Exception
- Generate Report (bisa nonaktif sesuai kondisi)
- [label dari data: r.title, r.description]
- Export PDF (bisa nonaktif sesuai kondisi)
- Export Excel (bisa nonaktif sesuai kondisi)
- Preview <meta.title> (bisa nonaktif sesuai kondisi)
- Save & Sync (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted; Cash & Bank → /transactions/bank-cash/posted; Create JE → /transactions/journal-entry
Isian/filter: month; label:Period –; select; date; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; textarea; label:⟨label⟩ ⟨children⟩; input:Search vendor or customer...; input:Search by document number, party, or tax code...; label:Tax Type All Tax Types; label:Payment Status All Statuses; label:Reporting Status All Statuses; label:Vendor / Customer; input:Search vendor, employee, or counterparty...; label:PPh Type All PPh Types; label:Vendor / Employee / Counterparty; label:Status All Status; label:VAT Type All VAT Types VAT Output VAT Input; label:e-Faktur Status All Statuses Matched Unmatched; label:Filing Status All Statuses; number; input; input:e.g. Salary Tax; checkbox; label:Tax Type All Types; label:Payment Status All Status Paid Pending Overdue Cancelled; label:Bank Account All Banks

### `/transactions` — Transactions
Grup menu: Financial
Judul/seksi di halaman: Transaksi; Tambah Jurnal Baru / Edit Transaksi; append replace-group / Ganti Transaksi … (PDF) replace / jurnal_penjualan_kasir / Import Jurnal Penj; Cash & Bank; Monthly Other Transaction Activity; Transaction Type Distribution; Monthly Sales Trend; Top Customers; Purchase Trend by Category; Top Vendors; Debit / Credit Validator; Journal Entry Activity
Tab di halaman (termasuk tab di panel detail): Transaksi; Sales; Purchase; Journal Entry; Cash & Bank; Other
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Tanggal; TX ID; No Voucher; Akun; Deskripsi; Debit; Kredit; Saldo Akhir; Referensi; Pihak; Kategori; Status; Cek; Jurnal Entri; Kode Akun; Tipe; Cek Rekonsiliasi; Invoice #; Date; Customer; Category; Subtotal; Discount; Tax; Total; Payment; Purchase ID; Vendor Invoice; Vendor; Input Tax; Approval; Posting; JE Number; Journal Date; Description; Source; Period; Total Debit; Total Credit; Difference
Komponen (36): TransactionsContent, TransactionsHeader, TransactionsFilterBar, TransactionsTable, TransactionsMainTabs, TransactionDrawer, TransactionEditModal, ImportRekeningKoranModal, TransactionsContext, SalesTabContent, PurchaseTabContent, JournalEntryTabContent, CashBankTabContent, OtherTabContent, StatusBadge, EmptyState, TabNav, SalesKpiRow, SalesChartSection, SalesTransactionTable, PurchaseKpiRow, PurchaseChartSection, PurchaseTransactionTable, TabExportMenu, JournalKpiRow, JournalBalanceValidator, JournalEntryTable, TabKpiCard, TabStatusBadge, AppIcon, SalesAreaChart, SalesDetailPanel, PurchaseBarChart, PurchaseDetailPanel, JournalActivityChart, JournalDetailPanel
Tombol/aksi (56):
- all / All / Jan–Des …
- all / All
- Hapus ( <selectedCount> )
- Arsip
- Import
- Export
- Download Jurnal (PDF)
- Jurnal Baru
- [ikon X]
- [label dari data: typeLabels[t]]
- Filter Lanjutan
- Reset
- Posting Semua (bisa nonaktif sesuai kondisi)
- Hapus
- Export Pilihan
- Batalkan tanda cek rekonsiliasi / Tandai sudah dicek/direkonsiliasi
- Lihat detail transaksi
- Edit transaksi
- Hapus transaksi — tidak dapat dibatalkan
- [label dari data: p]
- Tutup panel detail
- [ikon Copy]
- Cetak Voucher
- Buka Jurnal
- Tutup
- Pilih dari daftar
- Batal
- Simpan Jurnal Baru / Simpan Perubahan (submit form; bisa nonaktif sesuai kondisi)
- Rekening Koran Mutasi bank — Excel/PDF
- Jurnal Penjualan Kasir Laporan penjualan detail — PDF
- Coba File Lain
- Lanjutkan Semua ( <hasil.draf_jurnal.length> transaksi)
- Hanya Baris Baru ( <pendingImport.entriBaru.length> transaksi) (bisa nonaktif sesuai kondisi)
- Batal, kembali ke pratinjau
- append / Tambahkan … Transaksi Ini replace-group replace / Ganti Tabel dengan … Transaksi 
- + New Purchase
- + New Journal Entry
- New Adjustment
- [ikon Eye]
- [ikon Chevron Left] (bisa nonaktif sesuai kondisi)
- [ikon Chevron Right] (bisa nonaktif sesuai kondisi)
- [label dari data: action.label]
- [label dari data: inner]
- Post to GL
- Export Selected
- View details
- Edit invoice
- More actions
- Approve
- Edit purchase
- [label dari data: item.icon, item.label]
- Show only unbalanced
- Submit for Review
- Clear all filters
- View journal lines
- Edit entry
Link ke halaman lain: Lihat status ini di Account Payable → /accounts-payable; Buka Cash & Bank → /transactions/bank-cash
Isian/filter: text:Cari TX ID, deskripsi, pihak, referensi...; select; date; number:0; number:999.999.999; label:Tanggal Dari; label:Tanggal Sampai; label:Nominal Min (Rp); label:Nominal Max (Rp); checkbox; text:mis. 5401; text:mis. Beban Sewa Kantor; text:mis. 1101; text:mis. Kas & Bank — BCA; textarea; text; number; textarea:Catatan tambahan...; label:Tanggal; label:Tipe; label:Kode Akun; label:Nama Akun; label:Deskripsi; label:Nominal (Rp); label:Debit (Rp); label:Kredit (Rp); label:Referensi; label:Pihak; label:Kategori; label:Status

### `/transactions/bank-cash` — Cash & Bank
Grup menu: Financial

### `/transactions/bank-cash/cash-payment` — Vendor Bills (from Purchase)
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Vendor Bills (from Purchase); Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All statuses; Unpaid; Partially Paid; Overdue; On Hold; Paid; Auto; Area; Line; Column; Candle; OHLC Bar
Komponen (9): CashBankTabs, RekonInfoCells, CashReceiptTrendChart, salesStyleKit, CashBankTransactionModal, StatusBadge, SalesChartCrosshair, SalesCandleLayer, InteractiveDonutChart
Tombol/aksi (14):
- Retry
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- New Transaction
- Reset
- [ikon Chevron Down]
- [label dari data: o.label]
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Delete line
- Add invoice
- Add account (e.g. bank charges)
- Cancel
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
Isian/filter: input:Search purchase no., invoice, vendor...; select; label:Rows per page 10 25 50; input:Cari...; date; input:Select or type…; input:Taken from the invoice if left empty; input; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Date; label:Cash / bank account; label:Category; label:Party (customer / vendor / other); label:Reference (voucher / slip no.); label:Description

### `/transactions/bank-cash/cash-receipt` — Customer Invoices (from Sales)
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Customer Invoices (from Sales); Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All statuses; Unpaid; Partially Paid; Paid; Auto; Area; Line; Column; Candle; OHLC Bar
Komponen (9): CashBankTabs, RekonInfoCells, CashReceiptTrendChart, salesStyleKit, CashBankTransactionModal, StatusBadge, SalesChartCrosshair, SalesCandleLayer, InteractiveDonutChart
Tombol/aksi (14):
- Retry
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- New Transaction
- Reset
- [ikon Chevron Down]
- [label dari data: o.label]
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Delete line
- Add invoice
- Add account (e.g. bank charges)
- Cancel
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
Isian/filter: input:Search invoice no., customer, description...; select; label:Rows per page 10 25 50; input:Cari...; date; input:Select or type…; input:Taken from the invoice if left empty; input; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Date; label:Cash / bank account; label:Category; label:Party (customer / vendor / other); label:Reference (voucher / slip no.); label:Description

### `/transactions/bank-cash/exceptions` — Cash & Bank
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Cash & Bank; Exception List; Detail Exception; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Severity; High; Medium; Low; All Exception Types; All Sources; Classification; All Counterparties; All Assigned; Unassigned; Assigned to Me
Komponen (5): CashBankTabs, CashBankExceptions, CashBankTransactionModal, FilterSelect, sourceUi
Tombol/aksi (28):
- New Transaction
- Retry
- All dates
- Apply
- Reset
- View Detail
- Edit
- Mark Resolved (bisa nonaktif sesuai kondisi)
- [ikon X]
- Cancel
- Saving... / Save (bisa nonaktif sesuai kondisi)
- Source Data / AI Suggestion / History
- View Original File ↗
- Accept Suggestion
- Resolve
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Delete line
- Add invoice
- Add account (e.g. bank charges)
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- Select... (bisa nonaktif sesuai kondisi)
- [label dari data: heading]
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close (bisa nonaktif sesuai kondisi)
Isian/filter: date; text:Search ID, counterparty, or issue...; checkbox; input; select; label:From; label:To; label:Exception Type; label:Assign to me; label:Status; input:Select or type…; input:Taken from the invoice if left empty; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Date; label:Cash / bank account; label:Category; label:Party (customer / vendor / other); label:Reference (voucher / slip no.); label:Description; input:Search...; label:Rows per page

### `/transactions/bank-cash/journal-preview` — Cash & Bank
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Date; Cash / bank account; Party; Description; Reference; Source Data line; Created; Approved
Komponen (4): CashBankTabs, CashBankJournalPreview, CashBankTransactionModal, sourceUi
Pembatasan hak akses di halaman ini: level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (23):
- New Transaction
- all / All (…)
- Approve <pilihanDraft.length> (bisa nonaktif sesuai kondisi)
- Post <pilihanApproved.length> (bisa nonaktif sesuai kondisi)
- Clear selection
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- Edit (bisa nonaktif sesuai kondisi)
- Delete (bisa nonaktif sesuai kondisi)
- Approve (bisa nonaktif sesuai kondisi)
- Return to Draft (bisa nonaktif sesuai kondisi)
- Post to Ledger (bisa nonaktif sesuai kondisi)
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Delete line
- Add invoice
- Add account (e.g. bank charges)
- Cancel
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
- Select... (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- [label dari data: heading]
- [label dari data: p]
- Close (bisa nonaktif sesuai kondisi)
Isian/filter: text:Search no., party, invoice…; checkbox; date; select; input:Select or type…; input:Taken from the invoice if left empty; input; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Date; label:Cash / bank account; label:Category; label:Party (customer / vendor / other); label:Reference (voucher / slip no.); label:Description; input:Search...; label:Rows per page

### `/transactions/bank-cash/overview` — Pipeline
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Pipeline; Monthly Cash Flow; Balance per Account; Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Komponen (2): CashBankTabs, CashBankTransactionModal
Tombol/aksi (8):
- Retry
- New Transaction
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Delete line
- Add invoice
- Add account (e.g. bank charges)
- Cancel
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨unmatched⟩ Source Data lines are unmatched — click to open Reconciliation. → /transactions/bank-cash/reconciliation; Unmatched ⟨unmatched⟩ Source Data lines → /transactions/bank-cash/reconciliation; Draft (awaiting Approve) → /transactions/bank-cash/journal-preview; Approved (awaiting Post) → /transactions/bank-cash/journal-preview; Posted → /transactions/bank-cash/posted
Isian/filter: select; date; input:Select or type…; input:Taken from the invoice if left empty; input; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Date; label:Cash / bank account; label:Category; label:Party (customer / vendor / other); label:Reference (voucher / slip no.); label:Description

### `/transactions/bank-cash/posted` — Cash & Bank
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Directions; All Periods; All Accounts; Type; Invoice Type; Counter Account; Source; Bank Line Description; Bank Line Ref
Komponen (3): CashBankTabs, sourceUi, CashBankTransactionModal
Pembatasan hak akses di halaman ini: level 4+ (LEVEL_BALIK_JURNAL): membalik jurnal yang sudah diposting (Cash & Bank)
Tombol/aksi (20):
- Retry
- Reset
- Export CSV (bisa nonaktif sesuai kondisi)
- Close / Detail
- Reverse Journal
- Cancel (bisa nonaktif sesuai kondisi)
- Reversing... / Reverse Journal (bisa nonaktif sesuai kondisi)
- New Transaction
- Select... (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- [label dari data: heading]
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close (bisa nonaktif sesuai kondisi)
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Delete line
- Add invoice
- Add account (e.g. bank charges)
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
Isian/filter: checkbox; text:Search journal no., counterparty, invoice, or account...; textarea:E.g. matched to the wrong invoice, should be another one; date; label:Show reversed ( ⟨jumlahDibalik⟩ ); label:Reversal reason *; label:Reversal journal date; input:Search...; label:Rows per page; select; input:Select or type…; input:Taken from the invoice if left empty; input; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Date; label:Cash / bank account; label:Category; label:Party (customer / vendor / other); label:Reference (voucher / slip no.); label:Description

### `/transactions/bank-cash/reconciliation` — Reconciled History
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Reconciled History; Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Debit; Credit; Any keyword is enough; All keywords must appear
Komponen (9): CashBankTabs, NonInvoiceForm, BookMatchPanel, AutoRulesPanel, salesStyleKit, BankFeedContext, CashBankTransactionModal, sourceUi, InteractiveDonutChart
Tombol/aksi (45):
- Edit settings
- Cancel (bisa nonaktif sesuai kondisi)
- Saving… / Save (bisa nonaktif sesuai kondisi)
- Retry
- unreconciled / Unreconciled (…) / Reconciled (…)
- Applying… / Apply adjustments (…) (bisa nonaktif sesuai kondisi)
- Matching… / Auto-match (bisa nonaktif sesuai kondisi)
- Ignoring… / Ignore selected (…) (bisa nonaktif sesuai kondisi)
- Rule from first selected (bisa nonaktif sesuai kondisi)
- Clear
- Match (bisa nonaktif sesuai kondisi)
- Pair (bisa nonaktif sesuai kondisi)
- Transfer (bisa nonaktif sesuai kondisi)
- Match + adjustment (bisa nonaktif sesuai kondisi)
- Rule (bisa nonaktif sesuai kondisi)
- Ignore (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Already posted — reverse the transaction from the Posted tab / Remove match (bisa nonaktif sesuai kondisi)
- New Transaction
- Close
- Delete line
- Add line (e.g. tax)
- Saving… / Create DRAFT journal (bisa nonaktif sesuai kondisi)
- Match an existing transaction loading… / … with the same amount · … open
- Reconcile (bisa nonaktif sesuai kondisi)
- Rule from selected line / New rule
- Hide / Manage
- <saran.length> suggested rule found from lines you recorded by hand — review
- Edit first
- Create rule
- Disable / Enable
- Edit rule
- Delete rule
- Saving… / Save rule (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down]
- [label dari data: o.label]
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Add invoice
- Add account (e.g. bank charges)
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
- Select... (bisa nonaktif sesuai kondisi)
- [label dari data: heading]
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Settings › Account Mapping → /settings/account-mapping
Isian/filter: checkbox; input; select; input:Search description, amount or date…; checkbox:Select line; select:Transfer from account / Transfer to account; select:Adjustment category; input:Search invoice no., party, date or amount…; label:Enable adjustments; label:Limit per match (Rp); label:⟨x.label⟩ ⟨x.kosong⟩; label:Bank account; label:… selected / Select all… (…); label:Settle differences up to with an adjustment; label:Category Auto (bank fee / rounding); label:Show paid invoices; input:Search account (no. or name)…; number; input:Search number, party, description, amount…; input:invoice / PT Sinar Jaya payments / Bank admin fee; input:biaya adm; adm fee; input:invoice / sinar jaya / e.g. bca; input:TRX-; INV/2026; input:reversal; koreksi; input:2.500; 6.500; input:account / Only used if no exact amounts / No limit; input:No minimum; input:Applies to exact amounts; input:e.g. 5.000 — closed by adjustment; label:⟨judul⟩ ⟨petunjuk⟩

### `/transactions/bank-cash/source-data` — Cash & Bank
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Cash & Bank; Edit … / New Cash & Bank Transaction
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Cash Payment; Cash Receipt; Reconciliation; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All accounts; 1,234,567.89; 1.234.567,89; Day / Month; Month / Day; Money in; Money out
Komponen (9): BankMappings, CashBankTabs, ConfidenceBadge, ExtractionTemplates, ReviewLineModal, StatementReviewModal, sourceUi, BankFeedContext, CashBankTransactionModal
Tombol/aksi (31):
- Some lines are already matched — unmatch them first in the Reconciliation tab / Delete fil (bisa nonaktif sesuai kondisi)
- Review this line (needed before auto-match) / Correct this line (bisa nonaktif sesuai kondisi)
- Ignore (not a transaction to be recorded) (bisa nonaktif sesuai kondisi)
- Restore to Unmatched (bisa nonaktif sesuai kondisi)
- Delete line (bisa nonaktif sesuai kondisi)
- Retry
- all / All / review / Needs review (…)
- Cancel (bisa nonaktif sesuai kondisi)
- Saving... / Save (bisa nonaktif sesuai kondisi)
- Add
- Collapse / Expand
- Edit (bisa nonaktif sesuai kondisi)
- Delete mapping (bisa nonaktif sesuai kondisi)
- New Transaction
- Rename (bisa nonaktif sesuai kondisi)
- Delete template (bisa nonaktif sesuai kondisi)
- Saving… / Save & mark reviewed (bisa nonaktif sesuai kondisi)
- import / Importing… (bisa nonaktif sesuai kondisi)
- reread / Re-reading… / Re-read with these settings (bisa nonaktif sesuai kondisi)
- all / All lines / Not verified (…)
- Select... (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- [label dari data: heading]
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close (bisa nonaktif sesuai kondisi)
- receipt / Cash Receipt (money in) / Cash Payment (money out) (bisa nonaktif sesuai kondisi)
- Add invoice
- Add account (e.g. bank charges)
- Saving… / Save changes / Save as Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨m.transaction.tx_number⟩ → /transactions/bank-cash/journal-preview
Isian/filter: file; input:e.g. BCA, Mandiri, Kas Kasir; input:Printed on the statement; input:e.g. LAPORAN KAS KASIR; input; checkbox; label:Bank / source name; label:Target account (COA); label:Account number; label:Title keyword; label:Extraction template (optional); label:Notes; label:Active; date; textarea; label:Date; label:Balance after (optional); label:Description; label:Money in; label:Money out; label:⟨labelSimpan⟩; input:Search...; label:Rows per page; select; input:Select or type…; input:Taken from the invoice if left empty; input:Search account (no. or name)…; number:Amount; input:Line description (optional); label:Cash / bank account

### `/transactions/journal-entry` — Journal Entry
Grup menu: Financial
Judul/seksi di halaman: Journal Entry; Recent Activity; Journal Entry Volume
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Activities; Auto; Area; Line; Column; Candle; OHLC Bar; All Entries
Komponen (8): JournalEntryTabs, JournalEntryOverview, InteractiveDonutChart, SalesLoading, JeTrendCard, jeOverviewUi, SalesChartCrosshair, SalesCandleLayer
Tombol/aksi (6):
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Reset
- [ikon Chevron Down]
- [label dari data: o.label]
Link ke halaman lain: View All Exceptions → → /transactions/journal-entry/exceptions
Isian/filter: input:Search JE number, description, user...; select; label:Rows per page 10 25 50; input:Search...

### `/transactions/journal-entry/exceptions` — Exception List
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Exception List; Exception Detail; Journal Entry
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All (Exception Type); Marked as Exception; Rejected; Imbalanced; All (Source Type)
Komponen (3): JournalEntryTabs, JeNotice, SalesLoading
Tombol/aksi (10):
- [label dari data: current?.label]
- [label dari data: o.label]
- Reset
- Actions
- View Detail
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close
- Retry
Isian/filter: text:Search JE number or description...; select; label:Rows per page 10 25 50

### `/transactions/journal-entry/posted` — Posted Journal Entries
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Posted Journal Entries; Journal Entry
Tab di halaman (termasuk tab di panel detail): Posting Date; JE Number; Entry Date; Description; Source; Debit; Credit; Period; Approved By; Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Periods; All Sources
Komponen (3): JournalEntryTabs, JePostedKpiTile, JePostedPanel
Tombol/aksi (23):
- [label dari data: current?.label]
- [label dari data: o.label]
- Export
- Print List
- Export Selected ( <selectedRows.size> )
- Retry
- Posting Period All
- Apply
- Reset
- [label dari data: col.label]
- View
- [ikon More Horizontal]
- View Detail
- Copy JE Number
- Download PDF
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close
- Copy JE No.
- Print
- Show Less / View All
- [label dari data: a.label, a.sub]
Isian/filter: input:Search…; date; text:Search JE number, description, or source…; checkbox; select; label:From; label:To; label:Rows per page 5 10 25 50

### `/transactions/journal-entry/preview` — Select Journal Entry
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Select Journal Entry; Journal Entry Preview; Journal Entry
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): JE Number; Source Type; Source Reference; Entry Date; Posting Date; Period; Created by; Reviewed by; Approved by
Komponen (5): JournalEntryTabs, PreviewLayout, JePagination, SalesLoading, JeNotice
Tombol/aksi (6):
- [label dari data: t.jeNumber, t.description, statusLabels[t.status]]
- [label dari data: header]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Retry

### `/transactions/journal-entry/source-data` — Journal Source File List
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Journal Source File List; Journal Entry; Import Journal; Mapping Rules
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total JE Detected; Valid JE; Invalid JE
Komponen (4): JournalEntryTabs, ImportJournalModal, MappingRulesModal, JeNotice
Tombol/aksi (18):
- Upload File (bisa nonaktif sesuai kondisi)
- Excel Template
- Export (bisa nonaktif sesuai kondisi)
- Mapping Rules
- Actions (bisa nonaktif sesuai kondisi)
- Delete file
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Processing... / Create Journal (bisa nonaktif sesuai kondisi)
- [ikon Chevron Left] (bisa nonaktif sesuai kondisi)
- [ikon Chevron Right] (bisa nonaktif sesuai kondisi)
- Download template CSV
- Back
- Importing… / Import … Journal Entries (bisa nonaktif sesuai kondisi)
- Done
- Close
- Retry
Isian/filter: select; label:Rows per page 10 25 50; file

### `/transactions/journal-entry/transactions` — Journal Entry Transactions
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Journal Entry Transactions; Journal Entry; New Journal Entry; Import Journal
Tab di halaman (termasuk tab di panel detail): JE Number; Date; Description; Source; Debit; Credit; Status; Period; Created By; Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Status; All Sources; All Periods; Detail; Journal Lines
Komponen (8): JournalEntryTabs, NewJournalEntryModal, ImportJournalModal, JeKpiTile, JeFilterSelect, JeTablePagination, PrintMenu, AccountNameAutocomplete
Tombol/aksi (22):
- Import
- New Journal Entry
- Reset
- [label dari data: col.label]
- View
- Close
- [label dari data: dt.label]
- Add Line
- Cancel
- Generating… / Print PDF (bisa nonaktif sesuai kondisi)
- Saving… / Save Journal Entry (bisa nonaktif sesuai kondisi)
- Download template CSV
- Back
- Importing… / Import … Journal Entries (bisa nonaktif sesuai kondisi)
- Done
- [label dari data: current?.label]
- [label dari data: o.label]
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Preparing… (bisa nonaktif sesuai kondisi)
- [label dari data: o.icon, o.label, o.hint]
Isian/filter: text:Search JE number, description, or source…; input; date; select; input:Journal entry description; input:mis. INV-2026-1847; input:1100; number:0.00; textarea; label:JE Number; label:Entry Date; label:Period; label:Source Type; label:Description; label:Source Reference (optional); label:Journal Lines; label:Notes (optional); file; input:Search…; label:Rows per page

### `/transactions/other` — Other
Grup menu: Financial
Judul/seksi di halaman: Other Transactions
Tab di halaman (termasuk tab di panel detail): Overview; Categories; Review Queue; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Transactions; Under Review; Ready to Post; Posted Transactions; Posted Value; Posted This Month; Reversed; Deposit Type; Interest Rate (per year); Loan Term (Months); Effective Date; From Entity; To Entity; Settlement Type; Tax Treatment; Reimbursement Category; Event Category; Approval Owner
Komponen (6): OtherWorkspace, arapUi, moduleUi, otherUi, TemplatesModal, OtherImportModal
Tombol/aksi (32):
- Create Transaction (bisa nonaktif sesuai kondisi)
- Transaction Templates (bisa nonaktif sesuai kondisi)
- Import (bisa nonaktif sesuai kondisi)
- Export (bisa nonaktif sesuai kondisi)
- [label dari data: t.label]
- [label dari data: t.journal_no]
- [ikon Eye]
- View all templates
- [ikon Chevron Right]
- Show all / View transactions
- Reject (bisa nonaktif sesuai kondisi)
- Approve (bisa nonaktif sesuai kondisi)
- Post to GL (bisa nonaktif sesuai kondisi)
- Cancel
- [label dari data: t.journal_no, t.subtype_label]
- Blocking errors <nErr> Cannot be submitted, approved or posted until fixed
- Warnings only <nWarn> Can be posted, but should be reviewed
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- Delete (bisa nonaktif sesuai kondisi)
- Save Template (bisa nonaktif sesuai kondisi)
- [ikon Plus] (bisa nonaktif sesuai kondisi)
- <t.name> <t.code> · <t.usage> used
- Delete Template (bisa nonaktif sesuai kondisi)
- Import <valid.length> row(s) (bisa nonaktif sesuai kondisi)
- Choose File
- Download Template
Link ke halaman lain: View all → /transactions/other?tab=posted; [ikon ChevronRight] → /transactions/other?tab=categories; [ikon ChevronRight] → /transactions/other?tab=review; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: checkbox; select; textarea:Reason; date; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; textarea; label:⟨label⟩ ⟨children⟩; input; label:⟨l⟩ ⟨h⟩; label:Active; file

### `/transactions/other/create` — Transaction Information
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Transaction Information; Journal Preview; Supporting Document; Review & Submit; Summary
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Deposit Type; Interest Rate (per year); Loan Term (Months); Effective Date; From Entity; To Entity; Settlement Type; Tax Treatment; Reimbursement Category; Event Category; Approval Owner
Komponen (4): OtherTransactionForm, arapUi, moduleUi, otherUi
Tombol/aksi (21):
- [ikon Trash2]
- [ikon X]
- Save as Draft (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: judul, ket]
- use master rate
- Save Draft (bisa nonaktif sesuai kondisi)
- Submit for Review / Submit (bisa nonaktif sesuai kondisi)
- Post (bisa nonaktif sesuai kondisi)
- Back (bisa nonaktif sesuai kondisi)
- Next:
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- Delete (bisa nonaktif sesuai kondisi)
- Reject
Link ke halaman lain: Other Transactions → /transactions/other; Cancel → /transactions/other; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:0; input; select; date; number; file; textarea; textarea:Add additional notes (optional)...; checkbox; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; label:⟨label⟩ ⟨children⟩

### `/transactions/other/exceptions` — Sebaran Jenis Temuan
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Sebaran Jenis Temuan; Other; Tambah Jurnal Baru / Edit Transaksi; Edit Jurnal Other / Jurnal Other Baru
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Other Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): High; Medium; Low; TX ID; No Voucher; Jurnal Entri; Tanggal; Kode Akun; Deskripsi; Referensi; Pihak; Kategori; Tipe; Saldo Akhir; Cek Rekonsiliasi
Komponen (10): TransactionDrawer, OtherTabs, OtherJournalWorkspace, StatusBadge, TransactionsContext, TransactionEditModal, TabNav, otherStore, OtherJournalModal, AccountNameAutocomplete
Tombol/aksi (22):
- [grup aksi OtherActionButtons]
- Tandai Selesai (bisa nonaktif sesuai kondisi)
- Lihat jurnal →
- Jurnal Baru
- Approve Semua Draft ( <approvable.length> ) (bisa nonaktif sesuai kondisi)
- CSV
- [label dari data: t, n] (bisa nonaktif sesuai kondisi)
- Ringkas / Tampilkan … lainnya
- Tutup panel detail
- [ikon Copy]
- Cetak Voucher
- Buka Jurnal
- Tutup
- Batal
- Memproses… (bisa nonaktif sesuai kondisi)
- [ikon X]
- Pilih dari daftar
- Simpan Jurnal Baru / Simpan Perubahan (submit form; bisa nonaktif sesuai kondisi)
- [label dari data: inner]
- Tambah Baris
- Hapus baris (bisa nonaktif sesuai kondisi)
- Menyimpan… / Simpan Perubahan / Simpan sebagai Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Lihat status ini di Account Payable → /accounts-payable
Isian/filter: date; textarea; label:Tanggal posting (opsional, default = tanggal jurnal); label:Alasan penolakan; select; text:mis. 5401; text:mis. Beban Sewa Kantor; text:mis. 1101; text:mis. Kas & Bank — BCA; number:0; text; number; textarea:Catatan tambahan...; label:Tanggal; label:Tipe; label:Kode Akun; label:Nama Akun; label:Deskripsi; label:Nominal (Rp); label:Debit (Rp); label:Kredit (Rp); label:Referensi; label:Pihak; label:Kategori; label:Status; label:Status Pembayaran; label:Tanggal Jatuh Tempo; label:Jumlah Sudah Dibayar (Rp); label:Catatan (opsional); input

### `/transactions/other/legacy-overview` — Tren Other Bulanan
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Catatan: halaman lama (legacy) untuk Other Transaction
Judul/seksi di halaman: Tren Other Bulanan; Other per Kategori; Top Pihak Terkait; Daftar Jurnal Other; Other; Tambah Jurnal Baru / Edit Transaksi; Edit Jurnal Other / Jurnal Other Baru
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Other Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): TX ID; No Voucher; Jurnal Entri; Tanggal; Kode Akun; Deskripsi; Referensi; Pihak; Kategori; Tipe; Saldo Akhir; Cek Rekonsiliasi; No. Jurnal; Baris; Nilai; Status; Aksi
Komponen (15): KpiCard, TransactionDrawer, OtherTabs, OtherJournalTable, OtherJournalWorkspace, AppIcon, StatusBadge, TransactionsContext, TransactionEditModal, TabNav, DataTable, JePagination, otherStore, OtherJournalModal, AccountNameAutocomplete
Tombol/aksi (20):
- Jurnal Baru
- Approve Draft ( <approvable.length> ) (bisa nonaktif sesuai kondisi)
- Posting Disetujui ( <postable.length> ) (bisa nonaktif sesuai kondisi)
- Ekspor CSV
- [grup aksi OtherActionButtons]
- Tutup panel detail
- [ikon Copy]
- Cetak Voucher
- Buka Jurnal
- Tutup
- Batal
- Memproses… (bisa nonaktif sesuai kondisi)
- [ikon X]
- Pilih dari daftar
- Simpan Jurnal Baru / Simpan Perubahan (submit form; bisa nonaktif sesuai kondisi)
- [label dari data: inner]
- [label dari data: p]
- Tambah Baris
- Hapus baris (bisa nonaktif sesuai kondisi)
- Menyimpan… / Simpan Perubahan / Simpan sebagai Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Lihat status ini di Account Payable → /accounts-payable
Isian/filter: input:Cari no. jurnal, pihak, deskripsi...; select; date; textarea; label:Tanggal posting (opsional, default = tanggal jurnal); label:Alasan penolakan; text:mis. 5401; text:mis. Beban Sewa Kantor; text:mis. 1101; text:mis. Kas & Bank — BCA; number:0; text; number; textarea:Catatan tambahan...; label:Tanggal; label:Tipe; label:Kode Akun; label:Nama Akun; label:Deskripsi; label:Nominal (Rp); label:Debit (Rp); label:Kredit (Rp); label:Referensi; label:Pihak; label:Kategori; label:Status; label:Status Pembayaran; label:Tanggal Jatuh Tempo; label:Jumlah Sudah Dibayar (Rp); label:Catatan (opsional)

### `/transactions/other/posted` — Nilai Posting per Bulan
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Nilai Posting per Bulan; Linimasa Posting; Other; Tambah Jurnal Baru / Edit Transaksi; Edit Jurnal Other / Jurnal Other Baru
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Other Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): TX ID; No Voucher; Jurnal Entri; Tanggal; Kode Akun; Deskripsi; Referensi; Pihak; Kategori; Tipe; Saldo Akhir; Cek Rekonsiliasi
Komponen (10): StatusBadge, TransactionDrawer, OtherTabs, OtherJournalWorkspace, TransactionsContext, TransactionEditModal, TabNav, otherStore, OtherJournalModal, AccountNameAutocomplete
Tombol/aksi (18):
- Jurnal Baru
- Ekspor CSV
- <m.items.length> jurnal
- [label dari data: j.jeId, j.description]
- Tutup panel detail
- [ikon Copy]
- Cetak Voucher
- Buka Jurnal
- Tutup
- Batal
- Memproses… (bisa nonaktif sesuai kondisi)
- [ikon X]
- Pilih dari daftar
- Simpan Jurnal Baru / Simpan Perubahan (submit form; bisa nonaktif sesuai kondisi)
- [label dari data: inner]
- Tambah Baris
- Hapus baris (bisa nonaktif sesuai kondisi)
- Menyimpan… / Simpan Perubahan / Simpan sebagai Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Lihat status ini di Account Payable → /accounts-payable
Isian/filter: input:Cari jurnal terposting...; date; textarea; label:Tanggal posting (opsional, default = tanggal jurnal); label:Alasan penolakan; select; text:mis. 5401; text:mis. Beban Sewa Kantor; text:mis. 1101; text:mis. Kas & Bank — BCA; number:0; text; number; textarea:Catatan tambahan...; label:Tanggal; label:Tipe; label:Kode Akun; label:Nama Akun; label:Deskripsi; label:Nominal (Rp); label:Debit (Rp); label:Kredit (Rp); label:Referensi; label:Pihak; label:Kategori; label:Status; label:Status Pembayaran; label:Tanggal Jatuh Tempo; label:Jumlah Sudah Dibayar (Rp); label:Catatan (opsional)

### `/transactions/other/preview` — Other
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Other; Edit Jurnal Other / Jurnal Other Baru
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Other Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Draft; Perlu Perbaikan; Siap Diposting
Komponen (7): StatusBadge, OtherTabs, OtherJournalWorkspace, TabNav, otherStore, OtherJournalModal, AccountNameAutocomplete
Tombol/aksi (14):
- [grup aksi OtherActionButtons]
- [label dari data: s.hint, s.label, items.length]
- Jurnal Baru
- Approve Semua Draft ( ) (bisa nonaktif sesuai kondisi)
- Posting Semua Siap ( <grouped.ready.length> ) (bisa nonaktif sesuai kondisi)
- CSV
- Tampilkan voucher lagi
- Batal
- Memproses… (bisa nonaktif sesuai kondisi)
- [label dari data: inner]
- Tutup
- Tambah Baris
- Hapus baris (bisa nonaktif sesuai kondisi)
- Menyimpan… / Simpan Perubahan / Simpan sebagai Draft (bisa nonaktif sesuai kondisi)
Isian/filter: input:Cari no. jurnal, pihak, deskripsi...; date; textarea; label:Tanggal posting (opsional, default = tanggal jurnal); label:Alasan penolakan; input; input:mis. PT Sumber Makmur / INV-1847; input:Keterangan jurnal; input:1100; number:0; label:No. Jurnal; label:Tanggal; label:Pihak / Referensi (opsional); label:Deskripsi; label:Baris Jurnal; label:Catatan review (opsional)

### `/transactions/other/source-data` — Kualitas Data Sumber
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Kualitas Data Sumber; Komposisi Sumber; Other; Tambah Jurnal Baru / Edit Transaksi; Edit Jurnal Other / Jurnal Other Baru
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Other Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Tanggal; TX ID; Sumber; No. Jurnal; Akun; Akun Standar; Debit; Kredit; Aksi; Kondisi; No Voucher; Jurnal Entri; Kode Akun; Deskripsi; Referensi; Pihak; Kategori; Tipe; Saldo Akhir; Cek Rekonsiliasi
Komponen (13): DataTable, TransactionDrawer, JePagination, OtherTabs, OtherJournalWorkspace, AppIcon, StatusBadge, TransactionsContext, TransactionEditModal, TabNav, otherStore, OtherJournalModal, AccountNameAutocomplete
Tombol/aksi (21):
- Edit
- <s.name> <s.rows> baris
- [label dari data: label]
- Jurnal Baru
- Ekspor CSV
- Sumber: <source> ✕
- Tutup panel detail
- [ikon Copy]
- Cetak Voucher
- Buka Jurnal
- Tutup
- [label dari data: p]
- Batal
- Memproses… (bisa nonaktif sesuai kondisi)
- [ikon X]
- Pilih dari daftar
- Simpan Jurnal Baru / Simpan Perubahan (submit form; bisa nonaktif sesuai kondisi)
- [label dari data: inner]
- Tambah Baris
- Hapus baris (bisa nonaktif sesuai kondisi)
- Menyimpan… / Simpan Perubahan / Simpan sebagai Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Lihat status ini di Account Payable → /accounts-payable
Isian/filter: input:Cari TX ID, akun, pihak...; date; textarea; label:Tanggal posting (opsional, default = tanggal jurnal); label:Alasan penolakan; select; text:mis. 5401; text:mis. Beban Sewa Kantor; text:mis. 1101; text:mis. Kas & Bank — BCA; number:0; text; number; textarea:Catatan tambahan...; label:Tanggal; label:Tipe; label:Kode Akun; label:Nama Akun; label:Deskripsi; label:Nominal (Rp); label:Debit (Rp); label:Kredit (Rp); label:Referensi; label:Pihak; label:Kategori; label:Status; label:Status Pembayaran; label:Tanggal Jatuh Tempo; label:Jumlah Sudah Dibayar (Rp); label:Catatan (opsional)

### `/transactions/other/transaction` — Other
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Other; Tambah Jurnal Baru / Edit Transaksi; Edit Jurnal Other / Jurnal Other Baru
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Other Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): TX ID; No Voucher; Jurnal Entri; Tanggal; Kode Akun; Deskripsi; Referensi; Pihak; Kategori; Tipe; Saldo Akhir; Cek Rekonsiliasi
Komponen (10): StatusBadge, TransactionDrawer, OtherTabs, OtherJournalWorkspace, TransactionsContext, TransactionEditModal, TabNav, otherStore, OtherJournalModal, AccountNameAutocomplete
Tombol/aksi (21):
- Jurnal Baru
- Ekspor CSV ( <list.length> )
- [label dari data: FILTER_LABEL[f]]
- <j.jeId> · <j.description> · <j.lines.length> baris
- Tampilkan lagi ( tersisa)
- [grup aksi OtherActionButtons]
- Detail baris
- Tutup panel detail
- [ikon Copy]
- Cetak Voucher
- Buka Jurnal
- Tutup
- Batal
- Memproses… (bisa nonaktif sesuai kondisi)
- [ikon X]
- Pilih dari daftar
- Simpan Jurnal Baru / Simpan Perubahan (submit form; bisa nonaktif sesuai kondisi)
- [label dari data: inner]
- Tambah Baris
- Hapus baris (bisa nonaktif sesuai kondisi)
- Menyimpan… / Simpan Perubahan / Simpan sebagai Draft (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Lihat status ini di Account Payable → /accounts-payable
Isian/filter: input:Cari no. jurnal, pihak, deskripsi...; date; textarea; label:Tanggal posting (opsional, default = tanggal jurnal); label:Alasan penolakan; select; text:mis. 5401; text:mis. Beban Sewa Kantor; text:mis. 1101; text:mis. Kas & Bank — BCA; number:0; text; number; textarea:Catatan tambahan...; label:Tanggal; label:Tipe; label:Kode Akun; label:Nama Akun; label:Deskripsi; label:Nominal (Rp); label:Debit (Rp); label:Kredit (Rp); label:Referensi; label:Pihak; label:Kategori; label:Status; label:Status Pembayaran; label:Tanggal Jatuh Tempo; label:Jumlah Sudah Dibayar (Rp); label:Catatan (opsional)

### `/transactions/purchase` — Purchase
Grup menu: Financial
Judul/seksi di halaman: Purchase; Purchase Volume Trend
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Purchase Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Auto; Area; Line; Column; Candle; OHLC Bar
Komponen (11): PurchaseTabs, PurchaseKpiTile, PurchaseBreakdownCards, PurchaseVendorActivityCards, PurchaseExceptionSummary, PurchaseOverviewCharts, moduleUi, InteractiveDonutChart, SalesChartCrosshair, SalesCandleLayer, arapUi
Tombol/aksi (16):
- 01 Jan … – 31 Dec … (bisa nonaktif sesuai kondisi)
- This year
- Last year
- All time
- Done
- [ikon Chevron Down]
- [label dari data: o.label]
- Reset
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: View all exceptions → /transactions/purchase/exceptions; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date; label:From; label:To; input:Cari...; select; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/transactions/purchase/bill/new` — Bill Preview
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Bill Preview; VENDOR BILL; Edit … / Record …; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Vendor selected; Vendor invoice number filled; PO number filled for Purchase Order source; Every item has description, qty and unit price; Every item has a GL account; Accounts Payable account chosen; Input VAT account chosen (tax is charged); Due date is not before invoice date; Tax is charged on at least one item (Tax Mismatch); Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount; IDR - Indonesian Rupiah; All deliveries
Komponen (7): CreateBillForm, arapUi, SettlementForm, CurrencyRateFields, StatementsTab, FilterSelect, arapSalesUi
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (35):
- Select or type a vendor... (bisa nonaktif sesuai kondisi)
- <v.name> No vendor code · <v.bills> bill
- New vendor &quot; &quot;
- Print
- Close
- Preview
- Save Draft (bisa nonaktif sesuai kondisi)
- Submit for Approval (bisa nonaktif sesuai kondisi)
- Use automatic number
- Follow payment terms
- Add Item (bisa nonaktif sesuai kondisi)
- Remove item (bisa nonaktif sesuai kondisi)
- Add Item Add a line for another product or service. (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Cancel
- Reverse (bisa nonaktif sesuai kondisi)
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
Link ke halaman lain: Open Journal Preview → /transactions/purchase/preview; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:Search vendor name or code...; select; input:Optional; input; input:Invoice number from vendor; input:e.g. PO-2026-0042; date; input:e.g. GR-2026-0105; input:Short summary of what was purchased; textarea:e.g. Pay by bank transfer before the due date; input:Code; input:Item or service description; number; input:unit; number:0; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; input:0; input:Transfer / cheque number; textarea:ar / e.g. Partial settlement of invoices / e.g. Payment for J; input:Search … number...; checkbox:Select all; checkbox:Select …; checkbox; label:⟨children⟩; label:Record an unapplied amount ⟨cfg.unappliedHint⟩; date:Period start; date:Period end

### `/transactions/purchase/exceptions` — Purchase Exception List
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Purchase Exception List; Exception Detail; Purchase
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Purchase Transaction; Journal Preview; Exceptions; Posted
Komponen (4): PurchaseTabs, FilterSelect, moduleUi, arapUi
Tombol/aksi (19):
- Actions
- View detail
- [label dari data: a.label]
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close
- 01 Jan … – 31 Dec … (bisa nonaktif sesuai kondisi)
- This year
- Last year
- All time
- Done
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: text:Search by purchase ID, vendor, invoice number, exception type...; select; label:Rows per page 10 25 50; date; label:From; label:To; input; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/transactions/purchase/posted` — Posted Purchase List
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Posted Purchase List; Purchase
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Purchase Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Payment
Komponen (4): PurchaseTabs, FilterSelect, moduleUi, arapUi
Tombol/aksi (24):
- Export (bisa nonaktif sesuai kondisi)
- Export Selected ( <selectedRows.size> )
- Reset
- View
- [ikon More Horizontal]
- View Detail
- Copy Purchase ID
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- [ikon X]
- 01 Jan … – 31 Dec … (bisa nonaktif sesuai kondisi)
- This year
- Last year
- All time
- Done
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: text:Search by purchase ID, vendor, invoice number, PO number...; checkbox; select; label:Rows per page 5 10 25 50; date; label:From; label:To; input; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/transactions/purchase/preview` — Purchase
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Purchase
Tab di halaman (termasuk tab di panel detail): All; Pending; Approved; Posted; Other; Overview; Source Data; Purchase Transaction; Journal Preview; Exceptions
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Invoice Number; PO Number; Purchase ID; Source; Invoice Date; Total Payable; Vendor Name; Vendor ID; Category; Period; Due Date; Payment Terms; Currency; Prepared by; Approved by; Posted by; Subtotal; Discount; Input VAT; Input VAT Account; Accounts Payable Account; Accounts Payable
Komponen (5): PurchaseTabs, SalesLoading, PreviewLayout, moduleUi, arapUi
Tombol/aksi (20):
- [label dari data: tab.label, tab.count]
- PUR <t.purchaseId> <t.vendor>
- Reject (bisa nonaktif sesuai kondisi)
- Return for Correction (bisa nonaktif sesuai kondisi)
- approve / Approving… / Approve (bisa nonaktif sesuai kondisi)
- post / Posting… / Post to GL (bisa nonaktif sesuai kondisi)
- 01 Jan … – 31 Dec … (bisa nonaktif sesuai kondisi)
- This year
- Last year
- All time
- Done
- [label dari data: header]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Close
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: View Exception → /transactions/purchase/exceptions; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: text:Search purchase ID, vendor, or invoice...; date; label:From; label:To; select; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/transactions/purchase/source-data` — Purchase Source Record List
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Purchase Source Record List; Purchase; Upload Purchase Data; Mapping Rules
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Purchase Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Vendor; Vendor ID; Source Date; Period; Invoice Number; PO Number; Created By; Created Date; Net Amount; Tax Amount; Total Amount
Komponen (6): PurchaseTabs, ImportPurchaseModal, MappingRulesModal, moduleUi, JePagination, arapUi
Tombol/aksi (22):
- [label dari data: current?.label]
- [label dari data: o.label]
- Upload File (bisa nonaktif sesuai kondisi)
- Template Excel
- Export
- Mapping Rules
- Actions
- View detail
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close
- 01 Jan … – 31 Dec … (bisa nonaktif sesuai kondisi)
- This year
- Last year
- All time
- Done
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:Search...; text:Search source, invoice, PO, vendor...; select; label:Rows per page 10 25 50; date; label:From; label:To; file; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/transactions/purchase/transaction` — Purchase Transaction List
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Purchase Transaction List; Purchase
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Purchase Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): All Status; All Payment; Total; Pending Review; Approved; Total Amount; Invoice Number; PO Number; Invoice Date; Due Date; Payment Terms; Period; Created By; Approved By; Subtotal; Discount; Tax (Input VAT); Total Payable
Komponen (5): PurchaseTabs, FilterSelect, PrintMenu, moduleUi, arapUi
Tombol/aksi (25):
- Date Period All
- Clear
- Apply
- approve / Approving… / Approve (…) (bisa nonaktif sesuai kondisi)
- post / Posting… / Post (…) (bisa nonaktif sesuai kondisi)
- Actions
- View detail
- Previous page (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Next page (bisa nonaktif sesuai kondisi)
- Close
- 01 Jan … – 31 Dec … (bisa nonaktif sesuai kondisi)
- This year
- Last year
- All time
- Done
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- Preparing… (bisa nonaktif sesuai kondisi)
- [label dari data: o.icon, o.label, o.hint]
- Cancel
- [label dari data: confirmLabel] (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Reverse (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Create Bill → /transactions/purchase/bill/new; Edit → /transactions/purchase/bill/new?id=…; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: date; text:Search by purchase ID, vendor, invoice number, PO number...; checkbox:Select all … filtered transactions; checkbox; select; label:From; label:To; label:Rows per page 10 25 50; input; textarea; label:⟨label⟩ ⟨children⟩; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason

### `/transactions/sales` — Sales
Grup menu: Financial
Judul/seksi di halaman: Sales; Tren Sales Bulanan; Daftar Invoice Penjualan; Daftar File Sumber Penjualan; Mapping Rules; Daftar Transaksi Penjualan; Daftar Exception; Detail Exception; Daftar Transaksi Penjualan (Posted)
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; Sales Transaction; Journal Preview; Exceptions; Posted; Semua; Diproses; Siap Posting; Diposting
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Auto; Area; Line; Column; Candle; OHLC Bar; All Branches; Tanggal Transaksi; No. Invoice; Nama Customer; DPP (Sebelum Pajak); PPN (11%); Total Nilai; Total Baris Terdeteksi; Baris Valid; Baris Tidak Valid; Semua Customer; Semua Status (Pajak); Semua Status (Posting); Semua Project; Detail; Pembayaran; Jurnal; Riwayat; Akun Piutang Usaha; Akun Pendapatan; Akun PPN Keluaran; Akun PPh (Jika ada); Semua (Severity); High; Medium; Low; Semua (Exception Type); Semua (Assigned To); Belum Ditugaskan; Ditugaskan ke Saya; Semua Pelanggan; Status Pembayaran; Paid; Partial
Komponen (13): SalesClient, SalesOverview, SalesSourceData, SalesTransaction, SalesJournalPreview, SalesExceptions, SalesPosted, InteractiveDonutChart, SalesChartCrosshair, SalesLoading, SalesCandleLayer, PrintMenu, PreviewLayout
Tombol/aksi (60):
- 01 Jan … – 31 Dec …
- [ikon Chevron Down]
- [label dari data: o.label]
- Reset
- Halaman sebelumnya (bisa nonaktif sesuai kondisi)
- [label dari data: p]
- Halaman berikutnya (bisa nonaktif sesuai kondisi)
- Mengunggah... / Upload File (bisa nonaktif sesuai kondisi)
- Template Excel
- Export
- Mapping Rules
- Coba lagi
- Aksi (bisa nonaktif sesuai kondisi)
- Hapus file
- Memproses... / Buat Invoice (bisa nonaktif sesuai kondisi)
- [ikon Chevron Left] (bisa nonaktif sesuai kondisi)
- [ikon Chevron Right] (bisa nonaktif sesuai kondisi)
- [ikon X]
- Batal
- Menyimpan... / Simpan Mapping (bisa nonaktif sesuai kondisi)
- [label dari data: current?.label]
- Periode Tanggal Semua
- Terapkan
- [ikon Settings]
- Clear selection (bisa nonaktif sesuai kondisi)
- Posting... / Post selected (…) (bisa nonaktif sesuai kondisi)
- [ikon More Horizontal]
- Lihat
- Edit
- Approve
- Post
- Hapus
- Menyimpan... / Simpan (bisa nonaktif sesuai kondisi)
- [label dari data: tab.count]
- INV <inv.invoice_no> <inv.customer_name>
- Lihat Dokumen
- Edit Mapping (bisa nonaktif sesuai kondisi)
- Post Journal (bisa nonaktif sesuai kondisi)
- Tutup
- Lihat Detail
- Tandai Resolved
- Source Data / AI Suggestion / History
- Lihat File Asli ↗
- Accept Suggestion
- Resolve
- Cetak Daftar
- Export Terpilih ( <selectedRows.size> )
- Periode Posting Semua
- Salin No. Jurnal
- Lihat di General Ledger
- Download Bukti
- Salin Jurnal
- General Ledger
- Cetak
- Sembunyikan / Lihat Semua
- Preparing… (bisa nonaktif sesuai kondisi)
- [label dari data: o.icon, o.label, o.hint]
- [label dari data: header]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Tambah Transaksi → /transactions/sales/invoice/new
Isian/filter: input:Cari...; select; input:Cari Invoice, deskripsi, customer, no. jurnal...; label:Baris per halaman 10 25 50; file; date; checkbox; text:Search Invoice...; input; number; label:Dari; label:Sampai; label:Customer; label:Cabang; label:Deskripsi; label:DPP; label:Project; text:Cari nomor invoice atau pelanggan...; text:Cari ID, nama pelanggan, atau masalah...; label:Exception Type; label:Tugaskan ke saya; label:Status; text:Cari invoice, pelanggan, atau no jurnal...; label:Baris per halaman 5 10 25 50

### `/transactions/sales/invoice/new` — Import from Product
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Import from Product; Invoice Preview; INVOICE; Edit Invoice / Create Invoice; Edit … / Record …; Customer Details / New Customer; Email Statement
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Estimated realized FX gain / (loss); Total Allocated; Unapplied Amount; IDR - Indonesian Rupiah; All deliveries
Komponen (8): CreateInvoiceForm, arapUi, SettlementForm, CustomerModal, CurrencyRateFields, FilterSelect, StatementsTab, arapSalesUi
Pembatasan hak akses di halaman ini: level 3+ (LEVEL_INPUT): membuat/mengedit/menghapus draft dan mengirim (submit) dokumen; level 4+ (LEVEL_POST): posting ke buku besar, membatalkan/membalik (reverse) dokumen yang sudah posted
Tombol/aksi (40):
- Select or type a customer... (bisa nonaktif sesuai kondisi)
- <c.name> Not in customer master yet
- New customer &quot; &quot;
- Close
- Cancel
- Add Item (bisa nonaktif sesuai kondisi)
- Print
- Preview
- Delete (bisa nonaktif sesuai kondisi)
- Save Draft (bisa nonaktif sesuai kondisi)
- Submit for Approval (bisa nonaktif sesuai kondisi)
- View Details / Add Details (bisa nonaktif sesuai kondisi)
- Numbering (bisa nonaktif sesuai kondisi)
- Follow payment terms
- Clear project
- Import from Product (bisa nonaktif sesuai kondisi)
- Remove item (bisa nonaktif sesuai kondisi)
- Add Item Add a line for another product or service. (bisa nonaktif sesuai kondisi)
- [label dari data: label]
- Previous page (bisa nonaktif sesuai kondisi)
- Next page (bisa nonaktif sesuai kondisi)
- [label dari data: children] (bisa nonaktif sesuai kondisi)
- Reverse (bisa nonaktif sesuai kondisi)
- Use the next automatic number (bisa nonaktif sesuai kondisi)
- Overdue only / All open
- Print <cfg.settle> (bisa nonaktif sesuai kondisi)
- Submit <cfg.settle> (bisa nonaktif sesuai kondisi)
- Save Customer (bisa nonaktif sesuai kondisi)
- [ikon Chevron Down] (bisa nonaktif sesuai kondisi)
- [label dari data: o.label]
- [label dari data: l]
- Statement Generated / Generate Statement (bisa nonaktif sesuai kondisi)
- Email (bisa nonaktif sesuai kondisi)
- PDF (bisa nonaktif sesuai kondisi)
- Excel (bisa nonaktif sesuai kondisi)
- Email Statement (bisa nonaktif sesuai kondisi)
- Download PDF (bisa nonaktif sesuai kondisi)
- More actions
- Download the PDF and open my email app instead
- Send Email (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Open Journal Preview → /transactions/sales?tab=journal-preview; ⟨cfg.party⟩ Statement → …?tab=statements&party=…; Record ⟨cfg.settle⟩ → …?party=…&invoice=…; Open in Cash & Bank → /transactions/bank-cash/posted
Isian/filter: input:Search name or customer ID...; input:Search product or service...; checkbox; input:INV/YYYY/####; date; input:Head Office; input:e.g. PRJ-001 - ERP Implementation; textarea:Street, district, city, postal code, country; textarea:e.g. Payment by bank transfer to ...; input:Select product/service...; input; number; input:unit; number:0; select; textarea:e.g. Recorded against the wrong customer; label:Rows per page:; label:Reversal date; label:Reason; input:0; input:Transfer / cheque number; textarea:ar / e.g. Partial settlement of invoices / e.g. Payment for J; input:Search … number...; checkbox:Select all; checkbox:Select …; label:⟨children⟩; label:Record an unapplied amount ⟨cfg.unappliedHint⟩; input:Auto (CUST-###); input:01.234.567.8-901.000; email:finance@customer.co.id

### `/transactions/source-data` — Journal Entry
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Judul/seksi di halaman: Journal Entry
Tab di halaman (termasuk tab di panel detail): Overview; Source Data; JE Transaction; Journal Preview; Exceptions; Posted
Label lain yang tampil (kolom tabel, opsi filter, kartu KPI; BUKAN tab): Total Sources; Mapped to JE; Pending / Imported; Validation Errors; Source Type; Source Date; Amount; Currency; Account Code; Account Name; JE Reference; Sync Status; Mapping Status; Created Date; Vendor / Party
Komponen (1): JournalEntryTabs
Tombol/aksi (2):
- View
- ✕ Close
Isian/filter: input:Search by source ID, description, or vendor…; select

### `/year-end-closing` — Year-End Closing
Grup menu: Management
Judul/seksi di halaman: Year-End Closing; Daftar Tahun Buku; Detail Tahun yang Sudah Ditutup; Closing Snapshot; Closing Journal; Audit Trail; Dampak ke Modul Lain
Komponen (1): YearEndClosingClient
Tombol/aksi (16):
- Refresh (bisa nonaktif sesuai kondisi)
- Prev (bisa nonaktif sesuai kondisi)
- Next (bisa nonaktif sesuai kondisi)
- Filter
- Close FY <y.fiscal_year>
- View
- Checklist
- [ikon More Horizontal]
- Close FY <y.fiscal_year> again
- Re-open FY <y.fiscal_year>
- [ikon X] (bisa nonaktif sesuai kondisi)
- Closing journal preview <p.journal_preview.je_number>
- view / Close / Cancel (bisa nonaktif sesuai kondisi)
- Run Closing (bisa nonaktif sesuai kondisi)
- Cancel (bisa nonaktif sesuai kondisi)
- Re-open (bisa nonaktif sesuai kondisi)
Link ke halaman lain: Financial Statements → /financial-statements/balance-sheet; Open Statement Mapping → → /financial-statements/mapping; Review transactions → → /transactions/journal-entry
Isian/filter: input:Cari klien atau tahun buku...; radio; checkbox; select; textarea:Catatan (opsional), mis. sesuai hasil review audit internal; textarea:mis. Penyesuaian audit untuk beban akrual; label:all / All statuses; label:Active client only; label:Retained earnings account; label:Alasan (wajib)

### `/zafeb-ai` — /zafeb-ai
Tidak ada di sidebar (dibuka lewat tombol/link dari halaman lain).
Catatan: halaman lama; fungsinya sudah digantikan bubble chat Zake di pojok kanan bawah
