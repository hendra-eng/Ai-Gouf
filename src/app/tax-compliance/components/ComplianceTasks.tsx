'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';

const INITIAL_TASKS = [
  { id: 'task-pph21-file', task: 'File PPh 21 Aug 2026', taxType: 'PPh 21', period: 'Aug 2026', owner: 'Siti Rahayu', dueDate: 'Sep 10, 2026', status: 'In Progress', priority: 'High' },
  { id: 'task-pph23-file', task: 'File PPh 23 Aug 2026', taxType: 'PPh 23', period: 'Aug 2026', owner: 'Siti Rahayu', dueDate: 'Sep 10, 2026', status: 'Not Started', priority: 'High' },
  { id: 'task-pph25-pay', task: 'Pay PPh 25 Installment Aug', taxType: 'PPh 25', period: 'Aug 2026', owner: 'Budi Santoso', dueDate: 'Sep 15, 2026', status: 'In Progress', priority: 'Medium' },
  { id: 'task-ppn-recon', task: 'Reconcile PPN Aug 2026', taxType: 'PPN', period: 'Aug 2026', owner: 'Ahmad Fauzi', dueDate: 'Sep 25, 2026', status: 'Not Started', priority: 'Medium' },
  { id: 'task-depreciation', task: 'Review depreciation fiscal adjustment', taxType: 'PPh 29', period: 'FY 2026', owner: 'Ahmad Fauzi', dueDate: 'Oct 15, 2026', status: 'Blocked', priority: 'Low' },
  { id: 'task-ppn-file', task: 'File PPN Masa Aug 2026', taxType: 'PPN', period: 'Aug 2026', owner: 'Siti Rahayu', dueDate: 'Sep 30, 2026', status: 'Not Started', priority: 'High' },
];

const STATUS_CYCLE = ['Not Started', 'In Progress', 'Completed'] as const;

const STATUS_STYLES: Record<string, string> = {
  'Not Started': 'bg-muted text-muted-foreground',
  'In Progress': 'bg-info-subtle text-info',
  'Completed': 'bg-positive-subtle text-positive',
  'Blocked': 'bg-negative-subtle text-negative',
};

const PRIORITY_STYLES: Record<string, string> = {
  'High': 'text-negative',
  'Medium': 'text-warning',
  'Low': 'text-muted-foreground',
};

export default function ComplianceTasks() {
  const [tasks, setTasks] = useState(INITIAL_TASKS);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');

  const filtered = tasks.filter((t) => {
    const matchSearch = t.task.toLowerCase().includes(search.toLowerCase()) || t.owner.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || t.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const advanceStatus = (id: string) => {
    setTasks((prev) => prev.map((t) => {
      if (t.id !== id || t.status === 'Blocked') return t;
      const currentIndex = STATUS_CYCLE.indexOf(t.status as (typeof STATUS_CYCLE)[number]);
      const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length] ?? 'Not Started';
      return { ...t, status: nextStatus };
    }));
  };

  const handleAddTask = () => {
    if (!newTaskName.trim()) return;
    setTasks((prev) => [
      {
        id: `task-custom-${Date.now()}`,
        task: newTaskName.trim(),
        taxType: '—',
        period: 'Aug 2026',
        owner: 'Unassigned',
        dueDate: '—',
        status: 'Not Started',
        priority: 'Medium',
      },
      ...prev,
    ]);
    setNewTaskName('');
    setShowAddForm(false);
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-600 text-foreground">Compliance Tasks</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} tasks · Aug 2026</p>
        </div>
        <button
          onClick={() => setShowAddForm((p) => !p)}
          className="flex items-center gap-1.5 text-xs font-500 text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-lg bg-primary/10 border border-primary/20"
        >
          <Icon name="PlusIcon" size={12} />
          Add Task
        </button>
      </div>

      {showAddForm && (
        <div className="flex items-center gap-2 mb-4 animate-fade-in">
          <input
            autoFocus
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
            placeholder="Task name..."
            className="flex-1 bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none"
          />
          <button onClick={handleAddTask} className="px-3 py-2 text-xs font-600 text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors">
            Add
          </button>
          <button onClick={() => { setShowAddForm(false); setNewTaskName(''); }} className="px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2 flex-1">
          <Icon name="MagnifyingGlassIcon" size={14} className="text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none flex-1"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-muted border border-border rounded-lg px-3 py-2 text-sm text-foreground outline-none"
        >
          {['All', 'Not Started', 'In Progress', 'Completed', 'Blocked'].map((s) => (
            <option key={`task-filter-${s}`} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {filtered.map((task) => (
          <div
            key={task.id}
            onClick={() => advanceStatus(task.id)}
            title={task.status === 'Blocked' ? 'Blocked — resolve dependency first' : 'Click to advance status'}
            className={`flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/20 hover:bg-muted/30 transition-all group ${task.status === 'Blocked' ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              task.priority === 'High' ? 'bg-negative' : task.priority === 'Medium' ? 'bg-warning' : 'bg-muted-foreground'
            }`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-500 text-foreground truncate">{task.task}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-2xs text-muted-foreground">{task.taxType} · {task.period}</span>
                <span className="text-2xs text-muted-foreground">{task.owner}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">{task.dueDate}</span>
              <span className={`text-2xs font-600 px-2 py-0.5 rounded-full ${STATUS_STYLES[task.status]}`}>
                {task.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
