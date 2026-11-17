'use client';

// Daftar template ekstraksi rekening koran milik klien aktif
// (financial_transaction_bank_cash_import_templates): pola kolom yang sudah
// dipelajari otomatis (lolos validasi saldo) atau diatur manual di modal
// review. File berikutnya dengan header yang sama langsung memakai template
// ini. Template bisa diganti nama, dinonaktifkan, atau dihapus (file
// berikutnya dideteksi ulang dari nol).

import React, { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Layers, Pencil, Trash2 } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import {
  METHOD_LABEL,
  ROLE_LABEL,
  deleteBcTemplate,
  updateBcTemplate,
  useBcTemplates,
  type BcTemplate,
} from '@/lib/bankCashStore';
import {
  CHECKBOX_CLS, ICON_BTN, ICON_BTN_DANGER, PANEL_ICON_CHIP, SourcePanel, StatusPill, TD_CLS, TH_CLS, TR_CLS,
} from './sourceUi';

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
    <SourcePanel
      title="Extraction Templates"
      subtitle={`${aktif} active layout(s) — files with the same column layout are read automatically with these settings.`}
      leading={<span className={PANEL_ICON_CHIP}><Layers size={17} /></span>}
      open={buka}
      onHeaderClick={() => setBuka((b) => !b)}
      flush
      action={
        <button onClick={() => setBuka((b) => !b)} aria-label={buka ? 'Collapse' : 'Expand'} className={ICON_BTN}>
          <ChevronDown size={16} className={`transition-transform ${buka ? 'rotate-180' : ''}`} />
        </button>
      }
    >
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[960px] select-text border-separate border-spacing-0">
          <thead>
            <tr className="bg-neutral-300">
              {['Template', 'Columns', 'Source', 'Verified', 'Used', 'Last used', 'Status', ''].map((h, i) => (
                <th key={`${h}-${i}`} className={`${TH_CLS} text-left`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id} className={`${TR_CLS} ${t.is_active ? '' : 'opacity-60'}`}>
                <td className="px-2 py-2">
                  <span className="font-semibold text-neutral-900">{t.template_name || '—'}</span>
                  <span className="block text-[11px] text-neutral-500">
                    {t.file_type}{t.method ? ` · ${METHOD_LABEL[t.method]}` : ''}
                  </span>
                </td>
                <td className="max-w-[380px] px-2 py-2 text-[11px] text-neutral-500">{ringkasKolom(t)}</td>
                <td className={TD_CLS}>
                  <StatusPill tone={t.detected_by === 'manual' ? 'blue' : 'neutral'} label={t.detected_by === 'manual' ? 'Set manually' : 'Learned automatically'} />
                </td>
                <td className={`${TD_CLS} tabular-nums`}>{t.verified_pct === null ? '—' : `${t.verified_pct}%`}</td>
                <td className={`${TD_CLS} tabular-nums`}>{t.usage_count}×</td>
                <td className={`${TD_CLS} text-neutral-600`}>{(t.last_used_at || '').slice(0, 10) || '—'}</td>
                <td className={TD_CLS}>
                  <label
                    className="inline-flex cursor-pointer items-center gap-2"
                    title={t.is_active ? 'Deactivate (files with this layout will be detected from scratch)' : 'Activate'}
                  >
                    <input
                      type="checkbox"
                      checked={t.is_active}
                      disabled={busy === t.id}
                      onChange={(e) => jalankan(t.id, () => updateBcTemplate(clientId, t.id, { is_active: e.target.checked }),
                        e.target.checked ? 'Template activated.' : 'Template deactivated.')}
                      className={CHECKBOX_CLS}
                    />
                    <StatusPill tone={t.is_active ? 'emerald' : 'neutral'} label={t.is_active ? 'Active' : 'Inactive'} />
                  </label>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  <button onClick={() => gantiNama(t)} disabled={busy === t.id} className={ICON_BTN} title="Rename" aria-label="Rename template">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => hapus(t)} disabled={busy === t.id} className={ICON_BTN_DANGER} title="Delete template" aria-label="Delete template">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SourcePanel>
  );
}
