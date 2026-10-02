// 请求语言：查询参数 lang 优先，否则看 Accept-Language。缺省中文。
import { EN } from './locales/en.js';

export function localeOf(req) {
  const query = String(req?.query?.lang || '').trim().toLowerCase();
  if (query.startsWith('en')) return 'en';
  if (query.startsWith('zh')) return 'zh';
  const header = String(req?.get?.('accept-language') || '');
  const first = header.split(',')[0].trim().toLowerCase();
  if (first.startsWith('en')) return 'en';
  return 'zh';
}

export function localizeProfile(profile, locale) {
  if (locale !== 'en' || !profile) return profile;
  const graph = EN.graphs[profile.id] || {};
  const types = { ...EN.types, ...(EN.typeOverrides[profile.id] || {}) };
  const predicates = { ...EN.predicates, ...(EN.predicateOverrides[profile.id] || {}) };
  return {
    ...profile,
    name: graph.name || profile.name,
    book: graph.book || profile.book,
    description: graph.description || profile.description,
    source: profile.source
      ? { ...profile.source, name: graph.source || profile.source.name }
      : profile.source,
    unit: { ...profile.unit, ...(graph.unit || {}) },
    terms: { ...profile.terms, ...(graph.terms || {}) },
    rules: Object.fromEntries(Object.entries(profile.rules || {}).map(([code, rule]) => {
      const over = graph.rules?.[code] || EN.rules[code];
      return [code, over ? { ...rule, ...over } : rule];
    })),
    props: (profile.props || []).map((prop) => ({
      ...prop,
      label: graph.props?.[prop.key] || EN.props[prop.key] || prop.label,
    })),
    ontology: profile.ontology ? {
      ...profile.ontology,
      entity_types: (profile.ontology.entity_types || []).map((type) => ({
        ...type,
        name: types[type.code] || type.name,
      })),
      predicates: (profile.ontology.predicates || []).map((predicate) => ({
        ...predicate,
        name: predicates[predicate.code] || predicate.name,
      })),
    } : profile.ontology,
  };
}

export function localizeCategories(categories, locale) {
  if (locale !== 'en') return categories;
  return categories.map((category) => ({ ...category, ...(EN.categories[category.id] || {}) }));
}
