import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { setTheme, useTheme } from './theme.js';

export default function ThemeToggle() {
  const dark = useTheme() === 'dark';
  return <button type="button" className="icon-button theme-toggle" aria-label="Dark mode" aria-pressed={dark} title={`Switch to ${dark ? 'light' : 'dark'} mode`} onClick={() => setTheme(dark ? 'light' : 'dark')}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>;
}
