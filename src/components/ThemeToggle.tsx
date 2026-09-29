import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { readTheme, saveTheme } from '../theme';

export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);
  const dark = theme === 'dark';
  return <button type="button" className="theme-toggle" aria-label={`切换为${dark ? '明亮' : '暗色'}氛围`}
    title={`当前：${dark ? '暗色' : '明亮'}；切换为${dark ? '明亮' : '暗色'}`}
    onClick={() => setTheme(saveTheme(dark ? 'light' : 'dark'))}>
    {dark ? <Moon size={15} aria-hidden="true" /> : <Sun size={15} aria-hidden="true" />}
    <span>{dark ? '暗色' : '明亮'}</span>
  </button>;
}
