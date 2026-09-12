# Delivery Notes — Gouf Accounting Core V2

Tanggal delivery: 12 September 2026

## Scope yang diterapkan

1. Production authentication + client isolation.
2. Dashboard/Financial Statements Actual = POSTED only.
3. Multi-line `journal_entries` + `journal_lines` tanpa menghapus `jurnal_posting` legacy.
4. Standard Account Taxonomy + Account Roles + Client COA Mapping.
5. Struktur `src/app` dan UI existing dipertahankan; bridge/API diarahkan ke Accounting Core baru.

Lihat `ACCOUNTING_CORE_V2.md` untuk detail implementasi, endpoint, rollout, dan environment variable.

## File utama baru/diubah

### Backend
- `backend/modules/accounting_core.py`
- `backend/modules/auth.py`
- `backend/db_client.py`
- `backend/main.py`
- `backend/scripts/migrate_accounting_core_v2.py`
- `backend/tests/test_accounting_core_v2.py`
- `backend/.env.accounting-core.example`

### Frontend
- `src/app/login/page.tsx`
- `src/app/agent-ai/lib/api.js`
- `src/app/transactions/context/TransactionsContext.tsx`
- `src/app/transactions/lib/jurnalBridge.ts`
- `src/app/transactions/components/transactionData.ts`
- `src/lib/clientsStore.tsx`
- `src/app/components/KPIBentoGrid.tsx`
- `src/app/financial-statements/lib/useProfitLossData.ts`
- `src/app/financial-statements/lib/useBalanceSheetData.ts`
- `src/app/financial-statements/lib/useCashFlowData.ts`

## Verifikasi yang sudah dilakukan

- Python compile untuk file backend utama yang berubah: **OK**.
- Smoke test Accounting Core dengan database SQLite sementara: **OK**.
  - Client + COA dibuat.
  - Standard taxonomy/role mapping dibuat.
  - Jurnal Sales 3 baris dibuat: Dr AR / Cr Revenue / Cr Output VAT.
  - Journal berhasil diposting.
  - General Ledger POSTED menghasilkan 3 lines dan Debit = Credit.
- Full `pytest` auth tidak dapat dijalankan di environment packaging karena package `bcrypt` tidak terinstall dan internet package install tidak tersedia. `bcrypt==4.2.1` dan `PyJWT==2.13.0` sudah dicantumkan di `backend/requirements.txt`.
- Full Next.js build tidak dijalankan karena `node_modules` pada attachment tidak lengkap. Jalankan `npm ci` pada environment developer sebelum `npm run build`.

## Cara menjalankan setelah extract

### Backend
```bash
cd backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python scripts/migrate_accounting_core_v2.py --sync-legacy
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
npm ci
npm run dev:frontend
```

Atau setelah dependency frontend/backend siap:
```bash
npm run dev
```

## Environment production minimum

```env
APP_ENV=production
ALLOW_ANONYMOUS_DEV=false
ALLOW_FALLBACK_ADMIN=false
JWT_SECRET_KEY=<LONG_RANDOM_SECRET>
NEXT_PUBLIC_DEMO_MODE=false
```

Gunakan PostgreSQL untuk production dan backup database sebelum migration.
