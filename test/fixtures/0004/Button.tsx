import type { CSSProperties } from 'react';

export interface ButtonProps {
  label?: string;
  size?: 'md' | 'sm';
  count?: number;
  disabled?: boolean;
  tone?: string;
}

type Styles = Record<string, CSSProperties>;

const base: Styles = {
  root: {
    padding: 8,
  },
};

const variants: Record<string, Record<string, Styles>> = {};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Button({ label = 'Button', size = 'md', count = 1, disabled = false, tone = 'x' }: ButtonProps) {
  const v = { size };
  return <button data-n="root" style={s('root', v)} />;
}
