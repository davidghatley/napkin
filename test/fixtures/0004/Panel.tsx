import type { CSSProperties, ReactNode } from 'react';
import { Button } from './Button';

export interface PanelProps {
  title?: string;
  count?: number;
  badge?: boolean;
  children?: ReactNode;
  size?: 'md' | 'sm';
}

type Styles = Record<string, CSSProperties>;

const base: Styles = {
  root: {
    padding: 16,
  },
  body: {
    gap: 4,
  },
  note: {
    color: 'red',
  },
};

const variants: Record<string, Record<string, Styles>> = {};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Panel({ title = 'Hello', count = 3, badge = false, children, size = 'md' }: PanelProps) {
  const v = { size };
  return (
    <section data-n="root" style={s('root', v)}>
      {badge && <small data-n="note" style={s('note', v)} />}
      <Button data-n="cta" label="Buy" size="sm" count={5} disabled={true} tone={title} />
      <div data-n="body" style={s('body', v)}>
        {children}
      </div>
    </section>
  );
}
