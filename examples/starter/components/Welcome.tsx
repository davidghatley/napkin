import type { CSSProperties } from 'react';

export interface WelcomeProps {
  label?: string;
  size?: 'md' | 'sm' | 'lg';
}

type Styles = Record<string, CSSProperties>;

const base: Styles = {
  root: {
    display: 'flex',
    alignItems: 'center',
    border: 'none',
    borderRadius: 8,
    background: '#4f46e5',
    color: '#ffffff',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 15,
    cursor: 'pointer',
    gap: 8,
    padding: '10px 18px',
    boxSizing: 'border-box',
  },
};

const variants: Record<string, Record<string, Styles>> = {
  size: {
    sm: { root: { padding: '6px 12px', fontSize: 13 } },
    lg: { root: { padding: '14px 24px', fontSize: 18 } },
  },
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Welcome({ label = 'Make something', size = 'md' }: WelcomeProps) {
  const v = { size };
  return <button data-n="root" style={s('root', v)}>{label}</button>;
}
