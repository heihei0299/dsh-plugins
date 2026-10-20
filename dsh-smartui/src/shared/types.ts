/** SmartUI v1 is data, never executable markup, code, URLs, or command names. */
export type Cell = string | number | boolean | null;
export interface BlockBase { id: string; title?: string }
export interface CardBlock extends BlockBase {
  type: 'card'; body: string; value?: string; caption?: string;
}
export interface TableBlock extends BlockBase {
  type: 'table'; columns: { id: string; label: string }[]; rows: Cell[][];
}
export interface ChartBlock extends BlockBase {
  type: 'chart'; chartType: 'bar' | 'line';
  series: { id: string; label: string; points: { label: string; value: number }[] }[];
}
export interface SelectOption { value: string; label: string }
export interface FormField {
  id: string; label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'checkbox';
  required?: boolean; placeholder?: string;
  options?: SelectOption[]; min?: number; max?: number;
}
export interface FormBlock extends BlockBase {
  type: 'form'; fields: FormField[]; actionId: string;
}
export interface ChoicesBlock extends BlockBase {
  type: 'choices'; options: SelectOption[]; multiple?: boolean; actionId: string;
}
export type SmartUIBlock = CardBlock | TableBlock | ChartBlock | FormBlock | ChoicesBlock;
export interface SmartUIDocument {
  schemaVersion: 1; title?: string; summary: string; blocks: SmartUIBlock[];
}
export interface SmartUIMeta { smartui: SmartUIDocument }
export type FormValue = string | number | boolean | null;
export type FormValues = Record<string, FormValue>;
export interface SmartUIAction {
  schemaVersion: 1; sourceCallId: string; blockId: string; actionId: string;
  values: Record<string, FormValue | string[]>;
}
export const LIMITS = Object.freeze({
  bytes: 65_536, blocks: 20, rows: 200, columns: 12, points: 500,
  series: 4, fields: 20, options: 30, text: 8_000, label: 160, actionBytes: 16_384,
});
export const TOOL_NAME = 'render_smart_ui';
export const PACKAGE_NAME = '@local/dsh-smartui';
export const SETTINGS_ID = 'dsh-smartui';
export const LOCALE_NS = 'dsh-smartui';
export interface SmartUISettings { appearance: 'chatgpt' | 'native'; enableComponents: boolean }
export const DEFAULT_SETTINGS: Readonly<SmartUISettings> = Object.freeze({
  appearance: 'chatgpt', enableComponents: true,
});
