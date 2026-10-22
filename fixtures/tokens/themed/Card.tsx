import type { CSSProperties } from 'react';

export interface CardProps {
  title?: string;
}

const base: Record<string, CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '320px',
    padding: '16px',
    borderRadius: '12px',
    border: '2px solid var(--ink)',
    background: 'var(--panel)',
    fontFamily: 'Georgia, serif',
    color: 'var(--ink)',
  },
  image: {
    height: '140px',
    borderRadius: '8px',
    background: 'var(--warn)',
  },
  title: {
    margin: '0',
    fontSize: '22px',
    fontWeight: 400,
  },
  body: {
    margin: '0',
    fontSize: '15px',
    lineHeight: '1.4',
  },
};

const variants: Record<string, Record<string, Record<string, CSSProperties>>> = {
};

function s(node: string, v: Record<string, string>): CSSProperties {
  const out: CSSProperties = { ...base[node] };
  for (const axis in v) Object.assign(out, variants[axis]?.[v[axis]]?.[node]);
  return out;
}

export function Card({ title = 'From napkin to component' }: CardProps) {
  const v = {};
  return (
    <article data-n="card" style={s('card', v)}>
      <div data-n="image" style={s('image', v)} />
      <h3 data-n="title" style={s('title', v)}>{title}</h3>
      <p data-n="body" style={s('body', v)}>A person and an agent edit this Card at the same time.</p>
    </article>
  );
}
