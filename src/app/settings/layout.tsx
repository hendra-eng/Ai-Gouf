import React from 'react';
import SettingsShell from './components/SettingsShell';

export const metadata = {
  title: 'Settings — zafeb',
  description: 'Company profile, users, and configuration for the selected company.',
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsShell>{children}</SettingsShell>;
}
