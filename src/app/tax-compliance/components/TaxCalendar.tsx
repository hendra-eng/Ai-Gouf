'use client';
import React, { useMemo, useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useTaxComplianceData, type TaxObligation } from '../lib/taxBridge';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const TYPE_COLOR: Record<string, string> = {
  'PPh 21': 'bg-warning',
  'PPh 23': 'bg-warning',
  'PPh 25': 'bg-chart-2',
  'PPh 29': 'bg-chart-4',
  'PPN': 'bg-chart-3',
};

export default function TaxCalendar() {
  const { fx } = useCurrency();
  const { obligations, referenceDate } = useTaxComplianceData();
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [viewDate, setViewDate] = useState(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1));

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthLabel = `${MONTHS[month]} ${year}`;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStartDay = new Date(year, month, 1).getDay();

  const goToPrevMonth = () => { setViewDate(new Date(year, month - 1, 1)); setSelectedDay(null); };
  const goToNextMonth = () => { setViewDate(new Date(year, month + 1, 1)); setSelectedDay(null); };

  const cells: (number | null)[] = [
    ...Array(monthStartDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  // Kelompokkan obligasi (jatuh tempo) yang jatuh di bulan/tahun yang sedang dilihat, per tanggal.
  const eventsByDay = useMemo(() => {
    const map = new Map<number, TaxObligation[]>();
    obligations.forEach((o) => {
      if (o.dueDate.getFullYear() === year && o.dueDate.getMonth() === month) {
        const day = o.dueDate.getDate();
        const list = map.get(day) || [];
        list.push(o);
        map.set(day, list);
      }
    });
    return map;
  }, [obligations, year, month]);

  const getEventsForDay = (day: number) => eventsByDay.get(day) || [];

  return (
    <div id="tax-calendar" className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Tax Compliance Calendar</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{monthLabel} · Due dates from posted &amp; upcoming tax obligations</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={goToPrevMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Icon name="ChevronLeftIcon" size={16} />
          </button>
          <span className="text-sm font-semibold text-foreground w-28 text-center">{monthLabel}</span>
          <button onClick={goToNextMonth} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Icon name="ChevronRightIcon" size={16} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {[
          { label: 'PPh 21/23', color: 'bg-warning' },
          { label: 'PPN', color: 'bg-chart-3' },
          { label: 'PPh 25', color: 'bg-chart-2' },
          { label: 'PPh 29', color: 'bg-chart-4' },
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
          <div key={`cal-day-${d}`} className="text-center text-xs font-semibold text-muted-foreground py-2">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) => {
          const events = day ? getEventsForDay(day) : [];
          const isSelected = day === selectedDay;
          const isToday = day === referenceDate.getDate() && year === referenceDate.getFullYear() && month === referenceDate.getMonth();

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
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold mb-1 ${
                    isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                  }`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {events.slice(0, 2).map((ev, ei) => (
                      <div
                        key={`ev-${day}-${ei}`}
                        className={`text-2xs px-1 py-0.5 rounded text-white font-medium truncate ${TYPE_COLOR[ev.taxType] || 'bg-muted-foreground/60'}`}
                        title={`${ev.taxType} · ${ev.period}`}
                      >
                        {ev.taxType}
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
          <p className="text-sm font-semibold text-foreground mb-3">{MONTHS[month].slice(0, 3)} {selectedDay}, {year} — Tax Events</p>
          <div className="space-y-2">
            {getEventsForDay(selectedDay).map((ev, i) => (
              <div key={`detail-ev-${selectedDay}-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-muted">
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${TYPE_COLOR[ev.taxType] || 'bg-muted-foreground/60'}`} />
                <span className="text-sm text-foreground font-medium">{ev.taxType} · {ev.period}</span>
                <span className="text-xs text-muted-foreground">{fx(formatIDR(ev.taxAmount, true))}</span>
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
