import { Category, Channel } from '../types';

/** Canales por posición (y nombre como desempate). */
export function sortChannels(channels: Channel[]): Channel[] {
  return channels.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));
}

export function sortCategories(categories: Category[]): Category[] {
  return categories.slice().sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

export interface ChannelGroup {
  /** null = canales sin categoría (van arriba, sin encabezado). */
  category: Category | null;
  channels: Channel[];
}

/** Sin categoría primero; luego cada categoría por posición (aunque no tenga canales visibles, para poder usar su "+"). */
export function groupChannels(channels: Channel[], categories: Category[]): ChannelGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const loose = sortChannels(channels.filter((ch) => !ch.categoryId || !known.has(ch.categoryId)));
  const groups: ChannelGroup[] = [];
  if (loose.length > 0) groups.push({ category: null, channels: loose });
  for (const category of sortCategories(categories)) {
    groups.push({ category, channels: sortChannels(channels.filter((ch) => ch.categoryId === category.id)) });
  }
  return groups;
}
