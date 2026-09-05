'use client';
import React, { useState, useEffect } from 'react';
import { allNotes } from './noteData';
import NotesNavPanel from './NotesNavPanel';
import NoteSection from './NoteSection';
import { useLanguage } from '@/lib/language';

export default function NotesMainContent() {
  const { t } = useLanguage();
  const [activeNote, setActiveNote] = useState('01');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      for (const note of allNotes) {
        const el = document.getElementById(`ns-${note.num}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 100 && rect.bottom > 100) {
            setActiveNote(note.num);
            break;
          }
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const scrollTo = (num: string) => {
    document.getElementById(`ns-${num}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveNote(num);
    setMobileNavOpen(false);
  };

  const currentNote = allNotes.find(n => n.num === activeNote);

  return (
    <div className="flex gap-5 items-start">
      {/* Sticky sidebar nav — desktop */}
      <div className="hidden xl:block flex-shrink-0 w-52 sticky top-6 self-start">
        <NotesNavPanel activeNote={activeNote} onSelect={scrollTo} />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Mobile nav */}
        <div className="xl:hidden mb-4">
          <button
            onClick={() => setMobileNavOpen(p => !p)}
            className="w-full flex items-center justify-between px-4 py-3 bg-card border border-border rounded-xl text-[13px] font-semibold text-foreground"
          >
            <span>{t('Note')} {activeNote} — {t(currentNote?.title ?? '')}</span>
            <span className="text-muted-foreground text-xs">{mobileNavOpen ? '▲' : '▼'}</span>
          </button>
          {mobileNavOpen && (
            <div className="mt-1 bg-card border border-border rounded-xl overflow-hidden max-h-52 overflow-y-auto">
              {allNotes.map(note => (
                <button
                  key={`mn-${note.num}`}
                  onClick={() => scrollTo(note.num)}
                  className={`w-full text-left px-4 py-2.5 text-[12px] transition-colors ${
                    activeNote === note.num
                      ? 'bg-primary/10 text-primary font-semibold' :'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className="font-mono text-[10px] mr-2 tabular-nums">{note.num}</span>
                  {t(note.title)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* All note sections */}
        <div className="space-y-5">
          {allNotes.map(note => (
            <NoteSection key={`sec-${note.num}`} note={note} />
          ))}
        </div>
      </div>
    </div>
  );
}