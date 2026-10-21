// Generators for the file-format tests. Nothing here is committed as data: the corpora are made at test time.
//   makeCorpus(dir, n, seed)       n varied components in the 0003 dialect (INV-02). Each is built from a new component
//                                  by random valid edits, then given hand-style formatting (indent, quotes, comments,
//                                  blank lines, CRLF, trailing commas) that still reads to the same model.
//   makeOutOfDialect(dir, seed)    50 files napkin must open read-only (INV-04), each with the token its reason must point at.
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newComponentSource } from '../../src/tsx/write.js';
import { tsxCodec } from '../../src/codecs.js';
import { readComponent } from '../../src/tsx/read.js';
import { rng, nextValidEdit } from './fuzz.js';

const ROOTS = ['div', 'section', 'article', 'button', 'header', 'nav', 'ul', 'a'];
const NAMES = ['Badge', 'Tag', 'Toast', 'Chip', 'Panel', 'Tile', 'Banner', 'Avatar', 'Menu', 'Row', 'Hero', 'Field', 'Label', 'Meter', 'Crumb', 'Dock', 'Stat', 'Ribbon', 'Step', 'Pill'];

// Formatting a person might use. Each takes text and returns text; the generator keeps one only if the model is unchanged.
const FORMATS = {
  fourSpaces: (t) => t.replace(/^( +)/gm, (m) => ' '.repeat(m.length * 2)),
  tabs: (t) => t.replace(/^( +)/gm, (m) => '\t'.repeat(m.length / 2)),
  doubleQuotes: (t) => t.replace(/'([^'"\\\n]*)'/g, '"$1"'),
  noTrailingCommas: (t) => t.replace(/,\n(\s*)\}/g, '\n$1}'),
  headerComment: (t) => `// Hand-written note: keep this card's corners soft.\n${t}`,
  blockComment: (t) => t.replace('const base', '/* base styles, one property per line */\nconst base'),
  inlineComment: (t) => t.replace(/^(\s+)(display|padding|gap): /m, '$1// tuned by eye\n$1$2: '),
  extraBlankLines: (t) => t.replace(/^(function s|const variants)/gm, '\n$1'),
  noFinalNewline: (t) => t.replace(/\n$/, ''),
  crlf: (t) => t.replace(/\n/g, '\r\n'),
  semicolonlessInterface: (t) => t.replace(/^(\s+\w+\??: [^;\n]+);$/gm, '$1'),
};

export function makeCorpus(dir, n = 40, seed = 40, { skip = [] } = {}) {
  const rand = rng(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const files = [];
  const formats = Object.keys(FORMATS).filter((f) => !skip.includes(f));
  for (let i = 0; i < n; i++) {
    const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}`;
    let text = newComponentSource(name, pick(ROOTS));
    let { doc, state } = tsxCodec.load(text);
    const steps = 6 + Math.floor(rand() * 30);
    for (let k = 0, done = 0; done < steps && k < steps * 10; k++) {
      const r = nextValidEdit(doc, rand, i * 1000 + k);
      if (!r) continue;
      const saved = tsxCodec.save(state, doc, r.next);
      text = saved.text; state = saved.state; doc = r.next; done++;
    }
    // 0 to 3 formatting habits per file; i % 4 == 0 stays as napkin wrote it
    const habits = i % 4 === 0 ? [] : Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(formats));
    habits.sort((x, y) => (x === 'crlf') - (y === 'crlf')); // line endings last, so the whole file ends up with one kind
    for (const h of habits) {
      const t = FORMATS[h](text);
      try {
        const { id, ...a } = readComponent(t).doc; const { id: _, ...b } = readComponent(text).doc;
        if (JSON.stringify(a) === JSON.stringify(b)) text = t;
      } catch { /* this habit does not fit this file; skip it */ }
    }
    const file = join(dir, `${name}.tsx`);
    writeFileSync(file, text);
    files.push(file);
  }
  return files;
}

// --- out of dialect ---
const BUTTON = (root) => readFileSync(join(root, 'fixtures', 'Button', 'Button.tsx'), 'utf8');
// Each case: [name, transform(buttonText) -> text, token the reported line must contain (null: file-level reason)]
const swap = (from, to) => (t) => { if (!t.includes(from)) throw new Error(`case needs ${from}`); return t.replace(from, to); };
const chain = (...fns) => (t) => fns.reduce((x, f) => f(x), t);
export const OUT_OF_DIALECT = [
  ['hook-useState', swap("  const v = { size, state };", "  const [on] = useState(false);\n  const v = { size, state };"), 'useState'],
  ['hook-useEffect', swap("  const v = { size, state };", "  useEffect(() => {}, []);\n  const v = { size, state };"), 'useEffect'],
  ['hook-custom', swap("  const v = { size, state };", "  const theme = useTheme();\n  const v = { size, state };"), 'useTheme'],
  ['map', swap('{label}</span>', '{[1, 2].map((n) => <b key={n}>{n}</b>)}</span>'), 'map'],
  ['ternary-text', swap('{label}</span>', "{label ? 'a' : 'b'}</span>"), 'label ?'],
  ['logical-and', swap('{label}</span>', "{label && 'x'}</span>"), 'label &&'],
  ['spread-attr', swap('<button data-n="root"', '<button {...rest} data-n="root"'), '...rest'],
  ['spread-style', swap("const out: CSSProperties = { ...base[node] };", "const out: CSSProperties = { ...base[node], ...extra };"), null],
  ['spread-in-base', swap("  label: {\n    fontWeight: 600,", "  label: {\n    ...shared,\n    fontWeight: 600,"), '...shared'],
  ['class-component', () => `import { Component } from 'react';\n\nexport class Button extends Component {\n  render() {\n    return <button>hi</button>;\n  }\n}\n`, 'class Button'],
  ['default-export', swap('export function Button(', 'export default function Button('), 'export default'],
  ['arrow-component', swap("export function Button({ label = 'Button', size = 'md', state = 'default' }: ButtonProps) {", "export const Button = ({ label = 'Button', size = 'md', state = 'default' }: ButtonProps) => {"), 'export const Button'],
  ['onClick-handler', swap('<button data-n="root"', '<button onClick={() => {}} data-n="root"'), 'onClick'],
  ['className', swap('<button data-n="root"', '<button className="x" data-n="root"'), 'className'],
  ['inline-style-object', swap("style={s('label', v)}", 'style={{ fontWeight: 600 }}'), 'style={{'],
  ['style-other-call', swap("style={s('label', v)}", "style={t('label', v)}"), "t('label'"],
  ['style-wrong-id', swap("style={s('label', v)}", "style={s('other', v)}"), '<span'],
  ['missing-data-n', swap('<span data-n="label" style', '<span style'), '<span'],
  ['duplicate-data-n', swap('<span data-n="label" style={s(\'label\', v)}>{label}</span>', '<span data-n="root" style={s(\'root\', v)}>{label}</span>'), 'data-n="root"'],
  ['unknown-tag', chain(swap('<span data-n="label"', '<table data-n="label"'), swap('</span>', '</table>')), '<table'],
  ['component-tag', chain(swap('<span data-n="label"', '<Icon data-n="label"'), swap('</span>', '</Icon>')), '<Icon'],
  ['unknown-attribute', swap('<span data-n="label"', '<span title="x" data-n="label"'), 'title'],
  ['attr-expression', swap('<span data-n="label"', '<span id={label} data-n="label"'), 'id'],
  ['fragment', chain(swap('  return (\n    <button', '  return (\n    <>\n    <button'), swap('    </button>\n  );', '    </button>\n    </>\n  );')), 'return ('],
  ['template-literal-text', swap('{label}</span>', '{`x ${label}`}</span>'), '`x'],
  ['text-and-element', swap('{label}</span>', 'hi<b data-n="b" style={s(\'b\', v)} />{label}</span>'), '<span'],
  ['computed-key', swap("  label: {\n    fontWeight: 600,", "  label: {\n    [key]: 1,\n    fontWeight: 600,"), '[key]'],
  ['shorthand-style', swap("    fontWeight: 600,", "    fontWeight,"), 'fontWeight,'],
  ['style-variable', swap("    fontWeight: 600,", "    fontWeight: weight,"), 'weight'],
  ['style-expression', swap("    gap: 8,", "    gap: 4 * 2,"), '4 * 2'],
  ['style-nested-object', swap("    gap: 8,", "    gap: 8,\n    ':hover': { color: 'red' },"), ':hover'],
  ['second-component', (t) => t + "\nexport function Other() {\n  return <div />;\n}\n", 'Other'],
  ['extra-const', swap('function s(', 'const LIMIT = 3;\n\nfunction s('), 'LIMIT'],
  ['extra-function', swap('function s(', 'function helper() {\n  return 1;\n}\n\nfunction s('), 'helper'],
  ['enum-declaration', swap('const base:', 'enum Mode { A, B }\n\nconst base:'), 'enum Mode'],
  ['props-not-destructured', swap("{ label = 'Button', size = 'md', state = 'default' }: ButtonProps", 'props: ButtonProps'), 'props: ButtonProps'],
  ['props-rest', swap("{ label = 'Button', size = 'md', state = 'default' }: ButtonProps", "{ label = 'Button', size = 'md', state = 'default', ...rest }: ButtonProps"), '...rest'],
  ['prop-renamed', swap("{ label = 'Button',", "{ label: text = 'Button',"), 'label: text'],
  ['prop-default-expression', swap("label = 'Button'", "label = DEFAULT"), 'DEFAULT'],
  ['prop-type-number', swap('  label?: string;', '  label?: string;\n  count?: number;'), 'count'],
  ['prop-type-function', swap('  label?: string;', '  label?: string;\n  onPress?: () => void;'), 'onPress'],
  ['axis-without-default', swap("size = 'md', ", ''), 'size'],
  ['v-out-of-order', swap('const v = { size, state };', 'const v = { state, size };'), 'const v'],
  ['syntax-error', swap('    </button>\n  );', '  );'), null],
  ['not-a-component', () => "export const answer = 42;\n", null],
  ['empty-file', () => '', null],
  ['async-component', swap('export function Button(', 'export async function Button('), null],
  ['variants-unknown-node', swap("      root: {\n        padding: '4px 10px',", "      ghost: {\n        padding: '4px 10px',"), 'ghost'],
  ['variants-unknown-value', swap("    sm: {\n      root: {\n        padding: '4px 10px',", "    xs: {\n      root: {\n        padding: '4px 10px',"), 'xs'],
  ['base-unknown-node', swap("  label: {\n    fontWeight: 600,", "  ghost: {\n    fontWeight: 600,\n  },\n  label: {\n    fontWeight: 600,"), 'base'],
];

// 50 files, each named after its case.
export function makeOutOfDialect(dir, root) {
  const src = BUTTON(root);
  const out = [];
  for (const [name, transform, token] of OUT_OF_DIALECT) {
    const text = transform(src);
    const component = name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    const file = join(dir, `${component}.tsx`);
    writeFileSync(file, text);
    out.push({ name, file, text, token });
  }
  return out;
}
