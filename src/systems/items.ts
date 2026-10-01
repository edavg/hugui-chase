import { fetchJson } from './fetchJson';
import type { Language } from './i18n';

export type ItemKind = 'note' | 'key' | 'tool' | 'poster' | 'lore';

export interface ItemDef {
  id: string;
  kind: ItemKind;
  name_es: string;
  name_en: string;
  title_es?: string;
  title_en?: string;
  desc_es: string;
  desc_en: string;
  text_es?: string;
  text_en?: string;
}

export const POSTER_IDS = [
  'poster_1',
  'poster_2',
  'poster_3',
  'poster_4',
  'poster_5',
  'poster_6',
  'poster_7',
  'poster_8',
] as const;

export type PosterId = (typeof POSTER_IDS)[number];

export async function loadItemCatalog(): Promise<Map<string, ItemDef>> {
  const url = `${import.meta.env.BASE_URL}config/items.json`;
  const data = await fetchJson<{ items: ItemDef[] }>(url);
  const items = new Map(data.items.map((item) => [item.id, item]));
  // Catálogo extra del vertical slice (M9): se fusiona si existe y no pisa el
  // catálogo principal. Mantiene los añadidos de herramientas separados del
  // contenido narrativo.
  try {
    const extra = await fetchJson<{ items: ItemDef[] }>(
      `${import.meta.env.BASE_URL}config/items_extra.json`,
    );
    for (const item of extra.items) {
      if (!items.has(item.id)) {
        items.set(item.id, item);
      }
    }
  } catch {
    // Sin catálogo extra: el juego funciona solo con items.json.
  }
  return items;
}

export function itemName(def: ItemDef, lang: Language): string {
  return lang === 'es' ? def.name_es : def.name_en;
}

export function itemDesc(def: ItemDef, lang: Language): string {
  return lang === 'es' ? def.desc_es : def.desc_en;
}

export function itemTitle(def: ItemDef, lang: Language): string {
  if (lang === 'es') {
    return def.title_es ?? def.name_es;
  }
  return def.title_en ?? def.name_en;
}

export function itemText(def: ItemDef, lang: Language): string {
  return (lang === 'es' ? def.text_es : def.text_en) ?? '';
}
