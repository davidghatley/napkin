export type JSONValue =
  null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue };
export type Depth = 1 | 2 | 3;
export type Phase = "begin" | "change" | "commit" | "cancel";
export interface Control {
  id: string;
  type: string;
  label?: string;
  value: JSONValue;
  depth?: Depth;
  default?: JSONValue;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: (string | number | { label: string; value: JSONValue })[];
  figure?: string | { type: string; [key: string]: JSONValue };
  scrub?: string;
  disabled?: boolean;
  axes?: {
    tag: string;
    label?: string;
    min: number;
    max: number;
    default: number;
    step?: number;
  }[];
  fields?: (string | { name: string; type?: string })[];
  data?: Record<string, JSONValue>[];
  [key: string]: unknown;
}
export interface Section {
  id: string;
  label?: string;
  controls: Control[];
  depth?: Depth;
  studio?: string;
}
export interface Schema {
  revision?: string | number;
  sections: Section[];
  [key: string]: unknown;
}
export interface ValueEvent {
  control: string;
  value: JSONValue;
  previous: JSONValue;
  phase: Phase;
  source: string;
  transaction: string;
  baseRevision?: string | number;
}
export interface Context {
  control: Control;
  host: HTMLElement;
  get(): JSONValue;
  begin(source?: string): void;
  change(value: JSONValue): void;
  commit(): void;
  cancel(): void;
  isEditing(): boolean;
  set(value: JSONValue): void;
  subscribe(listener: (value: JSONValue) => void): () => void;
}
export interface View {
  element: HTMLElement;
  update?(value: JSONValue): void;
  destroy?(): void;
}
export interface Studio {
  update?(): void;
  depth?(depth: Depth): void;
  destroy?(): void;
}
export interface Options {
  keys?: Partial<
    Record<"increase" | "decrease" | "reset" | "studio" | "help", string[]>
  >;
  label?: string;
  direction?: "a" | "b" | "c";
  theme?: "light" | "dark";
  history?: boolean;
  onChange?(event: ValueEvent): void;
  onDepth?(section: string, depth: Depth): void;
}
export interface DialEvents {
  value: ValueEvent;
  conflict: {
    control: string;
    local: JSONValue;
    remote: JSONValue;
    baseRevision?: string | number;
    revision?: string | number;
  };
  depth: { section: string; depth: Depth };
  render: { revision?: string | number };
  paint: { control: string; value: JSONValue };
  asset: { control: string; file: File };
  command: { command: "undo" | "redo" };
}
export class Dials extends EventTarget {
  constructor(container: Element, options?: Options);
  readonly root: HTMLElement;
  revision?: string | number;
  schema: Schema;
  render(schema: Schema): this;
  update(
    values: Record<string, JSONValue>,
    options?: { revision?: string | number },
  ): this;
  get(id: string): JSONValue;
  values(): Record<string, JSONValue>;
  open(id: string, depth?: Depth): this;
  setDepth(section: string, depth: Depth, animate?: boolean): void;
  resizeStudio(section: string, width: number, height: number): void;
  begin(id: string, source?: string): void;
  change(id: string, value: JSONValue): void;
  commit(id: string): void;
  cancel(id: string): void;
  transact(id: string, value: JSONValue, source?: string): void;
  reset(id: string): void;
  undo(redo?: boolean): void;
  help(): void;
  destroy(): void;
  addEventListener<K extends keyof DialEvents>(
    type: K,
    listener: ((event: CustomEvent<DialEvents[K]>) => void) | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
}
export function render(
  schema: Schema,
  container: Element,
  options?: Options,
): Dials;
export function registerControl(
  type: string,
  plugin: {
    mount(context: Context): View;
    studio?(context: Context & { panel: Dials }, host: HTMLElement): Studio;
  },
): () => void;
export function registerFigure(
  type: string,
  draw: (host: HTMLElement, control: Control, value: JSONValue) => void,
): () => void;
export function expression(
  text: string,
  control?: Pick<Control, "min" | "max" | "step" | "unit">,
): number;
export const bindings: string[][];

export const defaultKeys: Record<
  "increase" | "decrease" | "reset" | "studio" | "help",
  string[]
>;
