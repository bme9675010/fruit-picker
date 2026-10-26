// collect-photos.mjs 與 train.mjs 共用：照片標題裡哪些字代表「不是蔬果本身」。
// 葉菜類、蕨類的照片本來就是葉子；金針花本來就是花，所以這些品項不排除對應的字。
export const LEAFY = new Set([
  'bok_choy', 'lettuce', 'water_spinach', 'basil', 'cilantro', 'celery', 'green_onion',
  'bird_nest_fern', 'fiddlehead', 'chayote_shoots', 'red_amaranth', 'sweet_potato_leaves', 'gai_lan', 'pea_shoots', 'leek',
]);
export const FLOWERY = new Set(['daylily', 'roselle']);

const BAD = 'paintings?|drawings?|illustrations?|engraving|lithograph|blossoms?|trees?|seedlings?|field|farm|harvest(ing)?|garden|dish(es)?|soup|salad|cake|pie|recipe|cooked|fried|stew|curry|juice|dried|jam|pickled?|stamp|map|logo|poster|book|insects?|butterfly|moth|caterpillar|beetle|bird|herbarium|specimen|pollen|karyotype|diagram|chart|statue|monument|sculpture';

// 標題是否看起來不是蔬果本身
export function badTitle(id, title) {
  const words = [BAD];
  if (!LEAFY.has(id)) words.push('leaf|leaves|plants?');
  if (!FLOWERY.has(id)) words.push('flowers?');
  return new RegExp(`\\b(${words.join('|')})\\b`, 'i').test(title.replace(/[_\-.()]/g, ' '));
}

// 維基共享資源搜尋時要排除的字
export function searchExclude(id) {
  const words = ['painting', 'drawing', 'illustration', 'engraving', 'blossom', 'tree', 'seedling', 'dish', 'soup', 'salad', 'cake', 'recipe', 'map', 'stamp', 'logo'];
  if (!LEAFY.has(id)) words.push('leaf');
  if (!FLOWERY.has(id)) words.push('flower', 'flowers');
  return words.map((w) => `-${w}`).join(' ');
}
