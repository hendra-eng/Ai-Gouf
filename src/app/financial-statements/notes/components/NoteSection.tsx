'use client';
import React, { useState } from 'react';
import { ChevronDown, ExternalLink, CheckCircle2, FileText, BookOpen } from 'lucide-react';
import type { NoteData } from './noteData';

interface Props { note: NoteData; }

const TAG_STYLE: Record<string, string> = {
  'Policy Note':         'bg-violet-50 text-violet-600 border border-violet-200',
  'Disclosed':           'bg-[var(--positive-bg)] text-positive border border-[var(--positive-light)]',
  'Supporting Schedule': 'bg-primary/8 text-primary border border-primary/20',
};

const STMT_STYLE: Record<string, string> = {
  'Balance Sheet':    'bg-blue-50 text-blue-600',
  'Profit & Loss':    'bg-emerald-50 text-emerald-600',
  'Equity Statement': 'bg-violet-50 text-violet-600',
  'All Statements':   'bg-amber-50 text-amber-600',
};

export default function NoteSection({ note }: Props) {
  const [openAccordion, setOpenAccordion] = useState<string[]>([]);
  const toggle = (id: string) =>
    setOpenAccordion(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);

  return (
    <div
      id={`ns-${note.num}`}
      className="bg-card border border-border rounded-xl overflow-hidden scroll-mt-6"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border">
        <div className="flex items-start gap-4">
          {/* Big note number */}
          <span className="text-[48px] font-black leading-none text-muted-foreground/10 tabular-nums flex-shrink-0 select-none">
            {note.num}
          </span>
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <h3 className="text-[15px] font-bold text-foreground leading-tight">{note.title}</h3>
              <span className={`disclosure-badge ${TAG_STYLE[note.tag]}`}>
                {note.tag === 'Disclosed'           && <CheckCircle2 size={9} />}
                {note.tag === 'Policy Note'         && <FileText size={9} />}
                {note.tag === 'Supporting Schedule' && <BookOpen size={9} />}
                {note.tag}
              </span>
            </div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${STMT_STYLE[note.relatedStatement] || 'bg-muted text-muted-foreground'}`}>
              Related: {note.relatedStatement}
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {/* Intro */}
        <p className="text-[13px] text-foreground/80 leading-7 border-l-2 border-primary/20 pl-4">
          {note.intro}
        </p>

        {/* Accordion (Note 03) */}
        {note.accordion && (
          <div className="space-y-1.5">
            {note.accordion.map(item => {
              const isOpen = openAccordion.includes(item.id);
              return (
                <div key={item.id} className="border border-border rounded-xl overflow-hidden">
                  <button
                    onClick={() => toggle(item.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors text-left"
                  >
                    <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
                    <ChevronDown
                      size={14}
                      className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <div
                    className="accordion-content"
                    style={{ maxHeight: isOpen ? '300px' : '0px', opacity: isOpen ? 1 : 0 }}
                  >
                    <div className="px-4 pb-4 pt-2 border-t border-border/50">
                      <p className="text-[12px] text-muted-foreground leading-7">{item.content}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tables */}
        {note.tables?.map(tbl => (
          <div key={tbl.id} className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-[12px]">
              <thead>
                <tr>
                  {tbl.headers.map((h, hi) => (
                    <th
                      key={`th-${tbl.id}-${hi}`}
                      className={`accounting-th ${hi === 0 ? 'text-left' : 'text-right'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tbl.rows.map(row => (
                  <tr
                    key={row.id}
                    className={`row-hover ${row.isTotal ? 'bg-muted/30 font-bold' : ''}`}
                  >
                    {row.cells.map((cell, ci) => {
                      const isNeg = cell.startsWith('(') || cell.startsWith('-');
                      return (
                        <td
                          key={`td-${row.id}-${ci}`}
                          className={`accounting-td ${ci === 0 ? 'text-left' : 'text-right tabular-nums'} ${isNeg && ci > 0 ? 'text-negative' : ''} ${row.isTotal ? 'font-bold' : ''}`}
                        >
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {/* Cross-references */}
        {note.crossRefs && note.crossRefs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">
              Cross-reference:
            </span>
            {note.crossRefs.map(ref => (
              <button
                key={ref.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/5 border border-primary/15 text-primary text-[11px] font-semibold hover:bg-primary/10 transition-colors"
              >
                {ref.label}
                <ExternalLink size={9} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}