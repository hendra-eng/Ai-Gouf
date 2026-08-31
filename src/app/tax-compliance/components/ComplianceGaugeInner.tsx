'use client';
import React from 'react';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';

interface Props { score: number; }

export default function ComplianceGaugeInner({ score }: Props) {
  const data = [
    { name: 'score', value: score, fill: score >= 90 ? 'var(--positive)' : score >= 75 ? 'var(--warning)' : 'var(--negative)' },
    { name: 'bg', value: 100, fill: 'var(--muted)' },
  ];

  return (
    <div className="relative flex items-center justify-center h-40">
      <ResponsiveContainer width="100%" height={160}>
        <RadialBarChart
          cx="50%" cy="80%"
          innerRadius="70%"
          outerRadius="100%"
          startAngle={180}
          endAngle={0}
          data={data}
          barSize={14}
        >
          <RadialBar dataKey="value" cornerRadius={7} background={false} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute bottom-6 text-center">
        <p className={`text-4xl font-800 font-tabular ${score >= 90 ? 'text-positive' : score >= 75 ? 'text-warning' : 'text-negative'}`}>
          {score}
        </p>
        <p className="text-xs text-muted-foreground">/ 100</p>
      </div>
    </div>
  );
}
