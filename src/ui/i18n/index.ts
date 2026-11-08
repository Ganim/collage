import { ptBR, type MessageKey } from './pt-BR'

export type { MessageKey }

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  return ptBR[key].replace(/\{(\w+)\}/g, (whole, name: string) => String(params[name] ?? whole))
}
