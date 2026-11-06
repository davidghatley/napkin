import type { CSSProperties } from 'react';

export interface ChipProps {
  label?: string;
  size?: 'md' | 'xs' | 'sm' | 'lg';
  tone?: 'neutral' | 'info' | 'ok' | 'warn';
  look?: 'plain' | 'soft' | 'solid' | 'line';
}

const base: Record<string, CSSProperties> = {
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderRadius: 999,
    border: '1.5px solid #c9ccd6',
    background: '#ffffff',
    color: '#3b4052',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 13,
  },
  label: {
    fontWeight: 600,
  },
};

const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
  size: {
    xs: {
      root: {
        padding: '1px 7px',
        fontSize: 10,
      },
    },
    sm: {
      root: {
        padding: '2px 10px',
        fontSize: 11,
      },
    },
    lg: {
      root: {
        padding: '7px 18px',
        fontSize: 16,
      },
    },
  },
  tone: {
    info: {
      root: {
        color: '#1d4fd8',
        borderColor: '#1d4fd8',
      },
    },
    ok: {
      root: {
        color: '#0f7a4a',
        borderColor: '#0f7a4a',
      },
    },
    warn: {
      root: {
        color: '#b4540a',
        borderColor: '#b4540a',
      },
    },
  },
  look: {
    soft: {
      root: {
        background: '#eef0f6',
        borderColor: 'transparent',
      },
    },
    solid: {
      root: {
        background: '#2b2f3f',
        color: '#ffffff',
        borderColor: '#2b2f3f',
      },
    },
    line: {
      root: {
        background: 'transparent',
        borderWidth: 2,
      },
    },
  },
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Chip({ label = 'Chip', size = 'md', tone = 'neutral', look = 'plain' }: ChipProps) {
  const v = { size, tone, look };
  return (
    <span data-n="root" style={s('root', v)}>
      <span data-n="label" style={s('label', v)}>{label}</span>
    </span>
  );
}
