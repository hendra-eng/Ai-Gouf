'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface TaxEvent {
  day: number;
  label: string;
  type: 'payment' | 'filing' | 'spt' | 'reconciliation' | 'close';
  color: string;
}

const EVENTS: TaxEvent[] = [
  { day: 1, label: 'Tax Period Close Aug', type: 'close', color: 'bg-muted-foreground/60' },
  { day: 10, label: 'PPh 21 Payment', type: 'payment', color: 'bg-warning' },
  { day: 10, label: 'PPh 23 Payment', type: 'payment', color: 'bg-warning' },
  { day: 15, label: 'PPh 25 Installment', type: 'payment', color: 'bg-chart-2' },
  { day: 20, label: 'Tax Reconciliation', type: 'reconciliation', color: 'bg-chart-4' },
  { day: 30, label: 'PPN Masa Filing', type: 'filing', color: 'bg-chart-3' },
  { day: 30, label: 'PPN Masa Payment', type: 'payment', color: 'bg-warning' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Data hanya tersedia untuk September 2026 (mock). Bulan lain akan tampil kosong.
const DATA_YEAR = 2026;
const DATA_MONTH = 8; // September (0-indexed)
const TODAY = { year: 2026, month: 7, day: 26 }; // 26 Aug 2026 (real "today" di app ini)

export default function TaxCalendar() {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [viewDate, setViewDate] = useState(new Date(DATA_YEAR, DATA_MONTH, 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = `${MONTHS[month]} ${year}`;
  const hasEventData = year === DATA_YEAR && month === DATA_MONTH;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStartDay = new Date(year, month, 1).getDay();

  const goToPrevMonth = () => { setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null); };
  const goToNextMonth = () => { setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null); };

  const cells: (number | null)[] = [
    ...Array(monthStartDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const getEventsForDay = (day: number) => (hasEventData ? EVENTS.filter((e) => e.day === day) : []);

  return (
    <div id="tax-calendar" className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">Tax Compliance Calendar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{monthLabel} · Tax events and deadlines</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToPrevMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Icon name="ChevronLeftIcon" size={16} />
          </button>
          <span className="text-sm font-600 text-foreground w-28 text-center">{monthLabel}</span>
          <button onClick={goToNextMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Icon name="ChevronRightIcon" size={16} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {[
          { label: 'Payment', color: 'bg-warning' },
          { label: 'Filing', color: 'bg-chart-3' },
          { label: 'Installment', color: 'bg-chart-2' },
          { label: 'Reconciliation', color: 'bg-chart-4' },
          { label: 'Period Close', color: 'bg-muted-foreground/60' },
        ].map((l) => (
          <div key={`cal-legend-${l.label}`} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${l.color}`} />
            <span className="text-xs text-muted-foreground">{l.label}</span>
          </div>
        ))}
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2">
        {DAYS.map((d) => (
          <div key={`cal-day-${d}`} className="text-center text-xs font-600 text-muted-foreground py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          const events = day ? getEventsForDay(day) : [];
          const isSelected = day === selectedDay;
          const isToday = day === TODAY.day && year === TODAY.year && month === TODAY.month;

          return (
            <div
              key={`cal-cell-${i}`}
              onClick={() => day && setSelectedDay(isSelected ? null : day)}
              className={`min-h-[72px] p-1.5 rounded-lg transition-all duration-150 ${
                day ? 'cursor-pointer' : ''
              } ${
                isSelected ? 'bg-primary/10 border border-primary/30' : day ?'hover:bg-muted/50 border border-transparent hover:border-border': ''
              }`}
            >
              {day && (
                <>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-600 mb-1 ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                  }`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {events.slice(0, 2).map((ev, ei) => (
                      <div
                        key={`ev-${day}-${ei}`}
                        className={`text-2xs px-1 py-0.5 rounded text-white font-500 truncate ${ev.color}`}
                        title={ev.label}
                      >
                        {ev.label.split(' ')[0]}
                      </div>
                    ))}
                    {events.length > 2 && (
                      <div className="text-2xs text-muted-foreground px-1">+{events.length - 2} more</div>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && getEventsForDay(selectedDay).length > 0 && (
        <div className="mt-4 pt-4 border-t border-border animate-fade-in">
          <p className="text-sm font-600 text-foreground mb-3">{MONTHS[month].slice(0, 3)} {selectedDay}, {year} — Tax Events</p>
          <div className="space-y-2">
            {getEventsForDay(selectedDay).map((ev, i) => (
              <div key={`detail-ev-${selectedDay}-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ev.color}`} />
                <span className="text-sm text-foreground font-500">{ev.label}</span>
                <button
                  onClick={() => document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="ml-auto text-xs text-primary hover:text-primary/80 transition-colors"
                >
                  View Details
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
