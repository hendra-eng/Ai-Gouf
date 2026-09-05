import React from 'react';
import { allNotes } from './noteData';

interface Props { activeNote: string; onSelect: (num: string) => void; }

export default function NotesNavPanel({ activeNote, onSelect }: Props) {
  return (
    <div className="bg-card border border-border rounded-xl p-3 overflow-hidden">
      <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-[0.1em] px-2 py-1 mb-1">
        NOTES
      </div>
      <div className="space-y-0.5">
        {allNotes.map(note => (
          <button
            key={`navp-${note.num}`}
            onClick={() => onSelect(note.num)}
            className={`note-nav-item w-full text-left ${activeNote === note.num ? 'active' : ''}`}
          >
            <span className="tabular-nums font-mono text-[10px] text-muted-foreground/50 w-5 flex-shrink-0 leading-none">
              {note.num}
            </span>
            <span className="text-[11px] leading-tight">{note.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}