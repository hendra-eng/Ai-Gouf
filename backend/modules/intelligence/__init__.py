"""
modules/intelligence/
======================
Kumpulan fitur domain "Intelligence" (sidebar: AI Financial Analyst,
Audit) lewat REST API /api/v1/intelligence/...:

    audit_v1.py -- Fitur halaman Audit: temuan (finding), tahapan audit
                    trail (stage), log aktivitas (activity), dan bukti
                    (evidence) -- 4 tabel dibuat manual oleh user lewat
                    Supabase SQL Editor, schema "6_Intelligence":
                    intelligence_audit_finding, intelligence_audit_stage,
                    intelligence_audit_activity, intelligence_audit_evidence.
                    Lihat db_client.py: AuditFindingRow/AuditStageRow/
                    AuditActivityRow/AuditEvidenceRow. Frontend:
                    src/app/audit/lib/auditBridge.ts.

Dipindah apa adanya dari main.py, TIDAK diubah auth (masih
Depends(auth.get_current_user) / Depends(auth.require_level(3)) dari
modules/auth/core.py, BUKAN get_current_user_v1) maupun bentuk
response-nya (masih response_model Pydantic langsung, BUKAN amplop
{status,message,data,errors}) supaya frontend tidak perlu diubah sama
sekali.

Sama seperti modules/asset/ & modules/planning/: karena path di file
lama SUDAH pakai konvensi v1 (/api/v1/intelligence/...), pemindahan ini
MENGHAPUS registrasi lama di main.py (bukan cuma menambah yang baru) --
kalau tidak, akan ada 2 handler bentrok di path yang sama. Perilaku
(path, auth, response) tetap identik, cuma lokasi kodenya yang pindah.

Catatan: intelligence_audit_activity terisi OTOMATIS (bukan diisi
manual user) -- setiap tambah_audit_finding()/ubah_audit_finding()/
tambah_audit_evidence() dipanggil, 1 baris activity ikut tercatat.
Kalau nanti AI Financial Analyst (halaman lain di grup Intelligence
ini) juga perlu dipindah, tambahkan file baru di folder ini (mis.
ai_financial_analyst_v1.py) mengikuti pola yang sama.
"""

from .audit_v1 import router  # noqa: F401