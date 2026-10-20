'use client';

import React, { useEffect, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { ImportTemplateSummary } from '@/lib/importTemplates';

// ============================================================
// Modal "Mapping Rules" (read-only) tab Source Data Purchase / Journal
// Entry / Other -- 2 bagian, tampil kalau prop-nya diisi:
//   1. loadTemplates: import template company aktif dari backend (format
//      kompleks/blok laporan -- resepnya dikelola di DB, belum ada editor).
//   2. columns: pemetaan kolom generik file upload (nama header yang
//      dikenali per field sistem) -- dipakai parser di browser.
// ============================================================

export interface MappingColumn { field: string; accepted: string[]; required?: boolean }

export default function MappingRulesModal({
  onClose, loadTemplates, columns, columnsNote,
}: {
  onClose: () => void;
  loadTemplates?: () => Promise<ImportTemplateSummary[]>;
  columns?: MappingColumn[];
  columnsNote?: string;
}) {
  const [templates, setTemplates] = useState<ImportTemplateSummary[]>([]);
  const [loading, setLoading] = useState(!!loadTemplates);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loadTemplates) return;
    let batal = false;
    loadTemplates()
      .then(data => { if (!batal) setTemplates(data); })
      .catch(err => { if (!batal) setError(err instanceof Error ? err.message : 'Failed to load mapping rules'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [loadTemplates]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="je-card bg-card w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-bold text-foreground">Mapping Rules</h3>
            <p className="text-xs text-muted-foreground mt-0.5">How source file columns map to system fields for the active company.</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded"><XMarkIcon className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <div className="px-5 py-4 space-y-5 overflow-y-auto scrollbar-thin">
          {loadTemplates && (
            <section className="space-y-3">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Import Templates</h4>
              {loading && <p className="text-xs text-muted-foreground text-center py-4">Loading templates…</p>}
              {error && <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              {!loading && !error && templates.length === 0 && (
                <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-3">
                  No import template has been set up for this company yet{columns ? ' -- uploaded files are read with the generic columns below.' : '.'}
                </p>
              )}
              {templates.map(tpl => (
                <div key={tpl.id} className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">{tpl.file_type || '-'}</span>
                    {tpl.format_type && <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">{tpl.format_type}</span>}
                    {tpl.client_code && <span className="text-xs text-muted-foreground">{tpl.client_code}</span>}
                  </div>
                  {tpl.description && <p className="text-xs text-muted-foreground">{tpl.description}</p>}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    {([
                      ['Header Row', tpl.header_row_index],
                      ['Data Starts', tpl.data_start_row_index],
                      ['Delimiter', tpl.delimiter],
                      ['Date Format', tpl.date_format],
                    ] as const).map(([k, v]) => (
                      <div key={k}>
                        <p className="text-muted-foreground">{k}</p>
                        <p className="font-semibold text-foreground font-mono">{v ?? '-'}</p>
                      </div>
                    ))}
                  </div>
                  {Object.keys(tpl.field_mapping).length > 0 && (
                    <table className="w-full text-xs border-t border-border">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-1.5 pr-3 font-semibold text-muted-foreground">System Field</th>
                          <th className="text-left py-1.5 font-semibold text-muted-foreground">Source</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {Object.entries(tpl.field_mapping).map(([field, source]) => (
                          <tr key={field}>
                            <td className="py-1.5 pr-3 font-mono text-foreground whitespace-nowrap">{field}</td>
                            <td className="py-1.5 text-muted-foreground">{String(source)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </section>
          )}

          {columns && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Generic Column Mapping</h4>
              {columnsNote && <p className="text-xs text-muted-foreground">{columnsNote}</p>}
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 pr-3 font-semibold text-muted-foreground">System Field</th>
                    <th className="text-left py-1.5 font-semibold text-muted-foreground">Accepted Column Headers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {columns.map(c => (
                    <tr key={c.field}>
                      <td className="py-1.5 pr-3 text-foreground whitespace-nowrap">
                        {c.field}{c.required && <span className="text-red-600"> *</span>}
                      </td>
                      <td className="py-1.5 text-muted-foreground">{c.accepted.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-muted-foreground">* required. Header matching ignores letter case, spaces and underscores.</p>
            </section>
          )}
        </div>
        <div className="flex justify-end px-5 py-4 border-t border-border">
          <button onClick={onClose} className="btn-secondary text-xs py-1.5">Close</button>
        </div>
      </div>
    </div>
  );
}
