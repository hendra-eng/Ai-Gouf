'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useTaxComplianceData, useTaxComplianceTasks } from '../lib/taxBridge';

interface ComplianceTask {
  id: string;
  task: string;
  taxType: string;
  period: string;
  owner: string;
  dueDate: string;
  status: 'Not Started' | 'In Progress' | 'Completed' | 'Blocked';
  priority: 'High' | 'Medium' | 'Low';
  isCustom: boolean; // [BARU] true = baris nyata di tax_compliance_task (bisa diklik utk ubah status tersimpan)
}

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
  const { obligations } = useTaxComplianceData();
  // [FIX] Task custom (ditambah manual lewat "Add Task") sekarang PERSISTEN
  // -- tersimpan ke tabel tax_compliance_task (schema 5_Planning), tidak
  // hilang lagi saat refresh halaman. Task yang auto-generated dari
  // obligasi belum lunas TETAP dihitung transien (tidak disimpan).
  const { tasks: savedTasks, addTask, advanceTaskStatus, removeTask } = useTaxComplianceTasks();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTaskName, setNewTaskName] = useState('');
  const [saving, setSaving] = useState(false);

  const generated: ComplianceTask[] = obligations
    .filter((o) => o.status !== 'Paid')
    .slice(0, 8)
    .map((o) => ({
      id: `task-${o.id}`,
      task: o.status === 'Overdue' ? `Resolve overdue ${o.taxType} — ${o.period}` : `File & pay ${o.taxType} — ${o.period}`,
      taxType: o.taxType,
      period: o.period,
      owner: 'Unassigned',
      dueDate: o.dueDateLabel,
      status: o.status === 'Overdue' ? 'Blocked' : (o.status === 'Due Soon' ? 'In Progress' : 'Not Started'),
      priority: o.status === 'Overdue' ? 'High' : o.status === 'Due Soon' ? 'High' : 'Medium',
      isCustom: false,
    }));

  const custom: ComplianceTask[] = savedTasks.map((t) => ({
    id: t.id,
    task: t.taskName,
    taxType: t.taxType || '—',
    period: t.period || '—',
    owner: t.owner || 'Unassigned',
    dueDate: t.dueDate || '—',
    status: (t.status as ComplianceTask['status']) || 'Not Started',
    priority: (t.priority as ComplianceTask['priority']) || 'Medium',
    isCustom: true,
  }));

  const tasks = [...generated, ...custom];

  const filtered = tasks.filter((t) => {
    const matchSearch = t.task.toLowerCase().includes(search.toLowerCase()) || t.owner.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || t.status === filterStatus;
    return matchSearch && matchStatus;
  });

  // [FIX] Hanya task CUSTOM (baris asli di DB) yang bisa diklik utk memajukan
  // status -- task auto-generated dari obligasi transien, statusnya ikut
  // status obligasi itu sendiri (bukan sesuatu yang bisa diklik lepas).
  const advanceStatus = async (t: ComplianceTask) => {
    if (!t.isCustom || t.status === 'Blocked') return;
    const currentIndex = STATUS_CYCLE.indexOf(t.status as (typeof STATUS_CYCLE)[number]);
    const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length] ?? 'Not Started';
    try {
      await advanceTaskStatus(t.id, nextStatus);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal mengubah status task');
    }
  };

  const handleAddTask = async () => {
    if (!newTaskName.trim()) return;
    setSaving(true);
    try {
      await addTask({ taskName: newTaskName.trim(), status: 'Not Started', priority: 'Medium' });
      setNewTaskName('');
      setShowAddForm(false);
      toast.success('Task tersimpan');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menyimpan task');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveTask = async (t: ComplianceTask) => {
    if (!t.isCustom) return;
    try {
      await removeTask(t.id);
      toast.success('Task dihapus');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Gagal menghapus task');
    }
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Compliance Tasks</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} tasks · Generated from unpaid tax obligations</p>
        </div>
        <button
          onClick={() => setShowAddForm((p) => !p)}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-lg bg-primary/10 border border-primary/20"
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
          <button
            onClick={handleAddTask}
            disabled={saving}
            className="px-3 py-2 text-xs font-semibold text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving…' : 'Add'}
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
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No open compliance tasks — all tax obligations are settled.</p>
        )}
        {filtered.map((task) => (
          <div
            key={task.id}
            onClick={() => advanceStatus(task)}
            title={!task.isCustom ? 'Auto-generated from unpaid obligations — resolve the obligation to change status' : task.status === 'Blocked' ? 'Blocked — resolve dependency first' : 'Click to advance status'}
            className={`flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary/20 hover:bg-muted/30 transition-all group ${(!task.isCustom || task.status === 'Blocked') ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
          >
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
              task.priority === 'High' ? 'bg-negative' : task.priority === 'Medium' ? 'bg-warning' : 'bg-muted-foreground'
            }`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{task.task}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-2xs text-muted-foreground">{task.taxType} · {task.period}</span>
                <span className="text-2xs text-muted-foreground">{task.owner}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-muted-foreground">{task.dueDate}</span>
              <span className={`text-2xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[task.status]}`}>
                {task.status}
              </span>
              {task.isCustom && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveTask(task); }}
                  className="text-muted-foreground hover:text-negative transition-colors opacity-0 group-hover:opacity-100"
                  title="Hapus task"
                >
                  <Icon name="TrashIcon" size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}