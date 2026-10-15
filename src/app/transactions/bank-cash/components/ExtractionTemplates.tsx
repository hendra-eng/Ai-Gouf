'use client';

// Daftar template ekstraksi rekening koran milik klien aktif
// (financial_transaction_bank_cash_import_templates): pola kolom yang sudah
// dipelajari otomatis (lolos validasi saldo) atau diatur manual di modal
// review. File berikutnya dengan header yang sama langsung memakai template
// ini. Template bisa diganti nama, dinonaktifkan, atau dihapus (file
// berikutnya dideteksi ulang dari nol).

import React, { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useActiveClient } from '@/lib/activeClient';
import {
  METHOD_LABEL,
  ROLE_LABEL,
  deleteBcTemplate,
  updateBcTemplate,
  useBcTemplates,
  type BcTemplate,
} from '@/lib/bankCashStore';

function ringkasKolom(t: BcTemplate): string {
  return (t.mapping_rules.columns || [])
    .filter((c) => c.role !== 'ignore')
    .map((c) => `${c.header} → ${ROLE_LABEL[c.role].split(' (')[0]}`)
    .join(' · ');
}

export default function ExtractionTemplates() {
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ? String(activeClientId) : null;
  const { templates, loading } = useBcTemplates(clientId);
  const [buka, setBuka] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  if (!clientId || (!loading && templates.length === 0)) return null;

  const jalankan = async (id: string, fn: () => Promise<unknown>, pesan: string) => {
    setBusy(id);
    try {
      await fn();
      toast.success(pesan);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update the extraction template.');
    } finally {
      setBusy(null);
    }
  };

  const gantiNama = (t: BcTemplate) => {
    const nama = window.prompt('Template name', t.template_name || '');
    if (nama === null || !nama.trim() || nama.trim() === t.template_name) return;
    jalankan(t.id, () => updateBcTemplate(clientId, t.id, { template_name: nama.trim() }), 'Template renamed.');
  };

  const hapus = (t: BcTemplate) => {
    if (!window.confirm(`Delete extraction template "${t.template_name}"? The next file with this layout will be detected from scratch.`)) return;
    jalankan(t.id, () => deleteBcTemplate(clientId, t.id), 'Extraction template deleted.');
  };

  const aktif = templates.filter((t) => t.is_active).length;

  return (
    <div className="card-elevated-md rounded-xl overflow-hidden mb-6">
      <button onClick={() => setBuka((b) => !b)} className="w-full flex items-center gap-3 px-5 py-4 text-left">
        <div>
          <h2 className="text-sm font-bold text-foreground">Extraction Templates</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {aktif} active layout(s) — files with the same column layout are read automatically with these settings.
          </p>
        </div>
        <ChevronDownIcon className={`w-4 h-4 ml-auto text-muted-foreground transition-transform ${buka ? 'rotate-180' : ''}`} />
      </button>
      {buka && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                {['Template', 'Columns', 'Source', 'Verified', 'Used', 'Last used', 'Active', ''].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className={`border-b border-border/50 ${t.is_active ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3 text-xs">
                    <span className="font-semibold text-foreground">{t.template_name || '—'}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t.file_type}{t.method ? ` · ${METHOD_LABEL[t.method]}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground max-w-[380px]">{ringkasKolom(t)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {t.detected_by === 'manual' ? 'Set manually' : 'Learned automatically'}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{t.verified_pct === null ? '—' : `${t.verified_pct}%`}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">{t.usage_count}×</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{(t.last_used_at || '').slice(0, 10) || '—'}</td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={t.is_active}
                      disabled={busy === t.id}
                      onChange={(e) => jalankan(t.id, () => updateBcTemplate(clientId, t.id, { is_active: e.target.checked }),
                        e.target.checked ? 'Template activated.' : 'Template deactivated.')}
                      title={t.is_active ? 'Deactivate (files with this layout will be detected from scratch)' : 'Activate'}
                      className="rounded border-border"
                    />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => gantiNama(t)} disabled={busy === t.id} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40" title="Rename">
                      <PencilSquareIcon className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => hapus(t)} disabled={busy === t.id} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-rose-600 disabled:opacity-40" title="Delete template">
                      <TrashIcon className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
