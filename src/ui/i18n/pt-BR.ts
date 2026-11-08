/** Flat dictionary. Placeholders look like {name}. */
export const ptBR = {
  'collection.defaultName': 'Fotos de {month}',
} as const

export type MessageKey = keyof typeof ptBR
