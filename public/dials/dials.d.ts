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
  /** Real bytes for a picture-showing control: a URL, or { url, name, type }. */
  source?: string | { url: string; name?: string; type?: string };
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
  /** Ignored: a section's full editor always opens in place, inside the host (there is no full-window studio). Kept so old hosts still type-check. */
  studio?: "viewport" | "inline";
  theme?: "light" | "dark";
  history?: boolean;
  onChange?(event: ValueEvent): void;
  onDepth?(section: string, depth: Depth): void;
  /** An element a section edits; kept in view at every depth (see Dials.setSubject). */
  subject?(section: string, schema: unknown): HTMLElement | null | undefined;
  /**
   * The bytes behind a control's value (an asset path, a file name, an image control): a URL,
   * Blob, File, ImageBitmap, canvas or <img>, a promise of one, or null when the host has none.
   */
  source?(
    control: Control,
    value: JSONValue,
  ): SourceBytes | null | Promise<SourceBytes | null>;
}
export type SourceBytes =
  | string
  | Blob
  | ImageBitmap
  | HTMLCanvasElement
  | OffscreenCanvas
  | HTMLImageElement;
export interface MotionModel {
  motion: { mode?: "bezier" | "spring"; duration: number; delay: number; loopRange?: [number, number]; [key: string]: JSONValue | undefined };
  frames?: Record<string, JSONValue>[];
  /** Section numbers keyed on the timeline, each written as a custom property in every frame. */
  keyed: { key: string; id: string; label: string; property: string | null; unit: string; initial: number }[];
  rotate?: number;
  loop: boolean;
  name: string;
}
export interface MotionPose {
  /** 0 to 1 of one iteration, after the delay. */
  u: number;
  segment: number;
  values: Record<string, number>;
  /** The CSS an element shows: transform, opacity and each keyed or fixed property. */
  style: Record<string, string | number>;
  x: number;
  opacity: number;
  rotate: number;
  scale: number;
  vars: Record<string, number>;
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
  /** A colour bound to a token was edited: the token on the document changed. */
  token: { control: string; name: string; value: string; phase: Phase };
  /** The colour studio's palette for a control changed. */
  palette: { control: string; palette: string[] };
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
  /** Reveal a control's section in the panel: 3 (default) opens its full editor in place, 2 opens the section, 1 folds it; the panel scrolls it into view. */
  open(id: string, depth?: Depth): this;
  /** Keep the element a section edits in view at every depth: under the head at dial and bench, atop the studio rail in the studio. null lets go. */
  setSubject(section: string, node: HTMLElement | null, animate?: boolean): this;
  /** 1 folds the section, 2 opens it, 3 opens it with its full editor; always inside the host. */
  setDepth(section: string, depth: Depth, animate?: boolean): void;
  /** Scroll the nearest scrolling box (never the page) so the section is in view. */
  reveal(section: string): this;
  begin(id: string, source?: string): void;
  change(id: string, value: JSONValue): void;
  commit(id: string): void;
  cancel(id: string): void;
  transact(id: string, value: JSONValue, source?: string): void;
  reset(id: string): void;
  undo(redo?: boolean): void;
  help(): void;
  /** The one model of a motion section that the studio ghost, motionAt and motionCode read. */
  motionModel(section: string): MotionModel;
  /** What a motion section shows `ms` after it starts, delay included. */
  motionAt(section: string, ms: number): MotionPose;
  motionCode(section: string): { transition: string; keyframes: string; waapi: string };
  applyMotionCode(section: string, text: string): void;
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
