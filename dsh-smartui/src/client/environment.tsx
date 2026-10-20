import * as React from 'react';
import { LOCALE_NS } from '../shared/types.js';
import type { ClientContext, ConfigForm, ConfigSnapshot, Translate } from './contracts.js';
export interface Environment { ctx: ClientContext; form: ConfigForm; t: Translate }
export const EnvironmentContext = React.createContext<Environment | null>(null);
export function useEnvironment(): Environment {
  const value = React.useContext(EnvironmentContext);
  if (!value) throw new Error('SmartUI environment is not mounted');
  React.useSyncExternalStore(
    listener => value.ctx.locale.subscribe(listener),
    () => value.ctx.locale.getSnapshot(),
    () => value.ctx.locale.getSnapshot(),
  );
  return value;
}
export function useSettings(form: ConfigForm): ConfigSnapshot {
  return React.useSyncExternalStore(listener => form.subscribe(listener), () => form.getSnapshot(), () => form.getSnapshot());
}
export function createEnvironment(ctx: ClientContext, form: ConfigForm): Environment {
  return { ctx, form, t: ctx.locale.bind(LOCALE_NS) };
}
