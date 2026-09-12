# Gouf Accounting — Accounting Core V2

Dokumen ini menjelaskan perubahan additive yang diterapkan tanpa merombak struktur `backend/`, `src/`, `src/app`, routing, atau tampilan UI existing.

## Lima perubahan yang diterapkan

### 1. Production authentication + client isolation

- `backend/modules/auth.py` tidak lagi memberikan `tahap_5` otomatis pada request tanpa token ketika `APP_ENV=production`.
- `ALLOW_ANONYMOUS_DEV` dan fallback `admin/admin123` hanya diizinkan untuk development dan default-nya OFF di production.
- `JWT_SECRET_KEY` wajib di-set di production.
- Ditambahkan `user_client_access` untuk pembatasan akses user ke client.
- Middleware pada `backend/main.py` melindungi route `/api/client/{client_id}/...`.
- Daftar client untuk role selain `tahap_5` difilter berdasarkan `user_client_access`.
- Frontend memiliki `/login`, token disimpan oleh API client dan dikirim sebagai `Authorization: Bearer ...`.

> Sebelum production, buat user sungguhan dan berikan mapping client-access. Jangan memakai fallback admin.

### 2. Dashboard / Financial Statements = POSTED only

Laporan Actual dan KPI sekarang menggunakan `Accounting Core` dan hanya membaca `JournalEntry.status == POSTED`.

Alur resmi:

`Source → Journal Entry → Journal Lines → POSTED GL → Trial Balance → Financial Statements`

Draft tetap dapat ditampilkan di transaction/review queue, tetapi tidak boleh ikut Actual financial statements.

### 3. Multi-line Journal Core tanpa menghapus `jurnal_posting`

Tabel baru:

- `journal_entries`
- `journal_lines`

`jurnal_posting` tetap dipertahankan sebagai compatibility/review queue. Fungsi `sync_legacy_to_core()` melakukan mirror idempotent dari struktur 2-kaki lama ke struktur header/detail baru.

Native Journal Core dapat membuat jurnal 2, 3, atau lebih line, misalnya:

```text
Sales Invoice
Dr Accounts Receivable       111
   Cr Revenue                    100
   Cr Output VAT                  11
```

Nilai di `journal_lines` memakai `NUMERIC(24,2)`, bukan `Float`.

### 4. Standard Taxonomy + Account Roles

Tabel baru:

- `standard_accounts`
- `account_roles`
- `coa_standard_mapping`
- `company_account_roles`

Nomor/nama akun tetap milik masing-masing client. Accounting Core memakai semantic meaning dan role.

Contoh:

```text
Client A: 1201 Piutang Usaha
Client B: 1-2300 Trade Receivable
             ↓
        AR_CONTROL
             ↓
        STD.ASSET.AR
```

Ini memungkinkan banyak industri memakai posting engine yang sama tanpa hard-code `1201`, `4101`, dan sebagainya.

### 5. UI / `src/app` tetap; bridge diarahkan ke Accounting Core

- Route dan struktur UI existing tidak dipindah.
- `TransactionsContext.tsx` sekarang membaca `/api/client/{id}/journal-entries`.
- `jurnalBridge.ts` dapat menerjemahkan journal header + multi-line journal ke model `Transaction[]` existing.
- Legacy journal masih kompatibel melalui `legacy_posting_id`.
- Backend semantic metadata (`sourceModule`, `standardAccountCode`, `accountRole`) dipakai lebih dahulu; klasifikasi nama akun menjadi fallback.
- Production tidak lagi menjadikan status `Posted` hanya dari state browser.
- Production tidak menampilkan sample financial data ketika API kosong/error jika `NEXT_PUBLIC_DEMO_MODE=false`.

## Endpoint Accounting Core baru

- `GET /api/accounting/standard-accounts`
- `GET /api/accounting/account-roles`
- `GET /api/client/{id}/accounting/mapping-health`
- `PUT /api/client/{id}/accounting/coa/{coa_id}/standard-mapping`
- `PUT /api/client/{id}/accounting/account-role/{role_code}`
- `GET /api/client/{id}/journal-entries`
- `POST /api/client/{id}/journal-entries`
- `POST /api/client/{id}/journal-entries/{journal_entry_id}/post`
- `GET /api/client/{id}/general-ledger`
- `POST /api/client/{id}/access` (khusus tahap_5)

## Langkah instalasi / migrasi

1. Backup database production.
2. Install dependency backend sesuai `backend/requirements.txt`.
3. Jalankan:

```bash
cd backend
python scripts/migrate_accounting_core_v2.py --sync-legacy
```

4. Set production environment:

```env
APP_ENV=production
ALLOW_ANONYMOUS_DEV=false
ALLOW_FALLBACK_ADMIN=false
JWT_SECRET_KEY=<RANDOM-SECRET-YANG-KUAT>
NEXT_PUBLIC_DEMO_MODE=false
```

5. Pastikan user production tersedia di tabel user dan mapping `user_client_access` sudah diberikan untuk user selain tahap_5.
6. Restart backend dan frontend.
7. Cek `/api/client/{id}/accounting/mapping-health` sebelum memulai konfigurasi client.

## Strategi rollout aman

- **Tahap 1:** jalankan dual structure. Legacy `jurnal_posting` tetap dipakai oleh flow existing; journal core mirror otomatis.
- **Tahap 2:** mulai modul baru membuat native `journal_entries/journal_lines`.
- **Tahap 3:** setelah seluruh UI/edit workflow native siap, legacy dapat dihentikan secara bertahap. Jangan hapus tabel legacy pada rollout pertama.

## Catatan penting

Perubahan ini adalah fondasi accounting core, bukan implementasi seluruh ERP dalam satu langkah. AR/AP open-item engine, fixed asset full lifecycle, bank reconciliation otomatis, inventory costing, consolidation, dan AI auto-posting tetap sebaiknya dibangun sebagai modul berikutnya di atas Journal Core ini.
