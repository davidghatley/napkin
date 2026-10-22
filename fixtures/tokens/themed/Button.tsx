import type { CSSProperties } from 'react';

export interface ButtonProps {
  label?: string;
  size?: 'md' | 'sm' | 'lg';
  state?: 'default' | 'hover';
}

const base: Record<string, CSSProperties> = {
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    borderRadius: 6,
    border: '2px solid var(--ink)',
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 15,
    cursor: 'pointer',
  },
  label: {
    fontWeight: 600,
  },
};

const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
  size: {
    sm: {
      root: {
        padding: '4px 10px',
        fontSize: 13,
      },
    },
    lg: {
      root: {
        padding: '12px 24px',
        fontSize: 18,
      },
    },
  },
  state: {
    hover: {
      root: {
        background: 'var(--ink)',
      },
    },
  },
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Button({ label = 'Button', size = 'md', state = 'default' }: ButtonProps) {
  const v = { size, state };
  return (
    <button data-n="root" style={s('root', v)}>
      <span data-n="label" style={s('label', v)}>{label}</span>
    </button>
  );
}
