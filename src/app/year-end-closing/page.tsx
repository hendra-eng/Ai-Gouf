import React from 'react';
import YearEndClosingClient from './components/YearEndClosingClient';

export const metadata = {
  title: 'Year-End Closing — zafeb',
  description: 'Close each fiscal year: lock its transactions and transfer the year\'s profit to retained earnings.',
};

export default function YearEndClosingPage() {
  return <YearEndClosingClient />;
}
