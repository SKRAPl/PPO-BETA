/*
 * PPO Store — источник правды теперь сами JSON-файлы в репозитории
 * (data/manifest.json, data/categories/<slug>.json), а не localStorage.
 *
 * ЧТЕНИЕ (getAllCategories/getItems и т.п.) работает для ЛЮБОГО посетителя
 * сайта — это обычный fetch() статических файлов, GitHub-токен не нужен.
 *
 * ЗАПИСЬ (addItem/editItem/... — все они async и возвращают {ok, error?})
 * идёт через js/github.js и требует, чтобы в админке был настроен доступ к
 * репозиторию (см. PPOGithub). Каждое такое действие — это отдельный коммит.
 */
(function (global) {
  "use strict";

  let categories = []; // [{slug, title, parent, color, hidden}]
  let itemsCache = {}; // slug -> string[]
  let initPromise = null;

  function dataPath(file) {
    return "data/" + file;
  }
  function categoryPath(slug) {
    return `data/categories/${slug}.json`;
  }

  async function fetchJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Не удалось загрузить ${path} (${res.status})`);
    return res.json();
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      categories = await fetchJson(dataPath("manifest.json"));
      await Promise.all(
        categories.map(async (c) => {
          try {
            itemsCache[c.slug] = await fetchJson(categoryPath(c.slug));
          } catch (e) {
            console.error("Не удалось загрузить категорию", c.slug, e);
            itemsCache[c.slug] = [];
          }
        })
      );
    })();
    return initPromise;
  }

  function getAllCategories() {
    return categories.filter((c) => !c.hidden);
  }

  function getAllCategoriesIncludingHidden() {
    return categories.slice();
  }

  function getCategory(slug) {
    return categories.find((c) => c.slug === slug) || null;
  }

  function getItems(slug) {
    const arr = itemsCache[slug] || [];
    return arr
      .map((text, idx) => ({ id: String(idx), text }))
      .filter((it) => it.text !== ""); // пустые строки — визуальные "прокладки", в админке их незачем показывать
  }

  // Полный массив как есть, ВКЛЮЧАЯ пустые "прокладки" — нужен только для
  // отрисовки настоящего сайта (js/sync.js), чтобы сетка карточек не съезжала.
  function getRawItems(slug) {
    return (itemsCache[slug] || []).slice();
  }

  // ---------- запись: категории (манифест — один файл) ----------
  async function commitManifest(mutateFn, message) {
    const res = await global.PPOGithub.readModifyWrite(dataPath("manifest.json"), (current) => {
      const list = current || [];
      return mutateFn(list);
    }, message);
    if (res.ok) categories = res.value;
    return res;
  }

  function slugify(text) {
    const map = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
      и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
      с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
      ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    };
    let out = "";
    for (const ch of String(text).toLowerCase()) {
      if (map[ch] !== undefined) out += map[ch];
      else if (/[a-z0-9]/.test(ch)) out += ch;
      else out += "-";
    }
    return out.replace(/-+/g, "-").replace(/^-|-$/g, "") || "category";
  }

  async function addCategory(title, parentSlug, color) {
    title = String(title || "").trim();
    if (!title) return { ok: false, error: "Введите название категории." };
    let newSlug;
    const res = await commitManifest((list) => {
      const existing = new Set(list.map((c) => c.slug));
      let base = slugify(title);
      let slug = base;
      let n = 1;
      while (existing.has(slug)) { n += 1; slug = `${base}-${n}`; }
      newSlug = slug;
      return list.concat([{ slug, title, parent: parentSlug || null, color: color || null, hidden: false }]);
    }, `Админка: добавлена категория «${title}»`);
    if (!res.ok) return res;
    // создаём пустой файл фраз для новой категории
    const putRes = await global.PPOGithub.putFile(categoryPath(newSlug), "[]\n", `Админка: создан файл категории «${title}»`);
    if (!putRes.ok) return putRes;
    itemsCache[newSlug] = [];
    return { ok: true, slug: newSlug };
  }

  async function renameCategory(slug, newTitle) {
    newTitle = String(newTitle || "").trim();
    if (!newTitle) return { ok: false, error: "Название не может быть пустым." };
    return commitManifest((list) => list.map((c) => (c.slug === slug ? Object.assign({}, c, { title: newTitle }) : c)),
      `Админка: переименована категория «${slug}» → «${newTitle}»`);
  }

  async function removeCategory(slug) {
    return commitManifest((list) => list.map((c) => (c.slug === slug ? Object.assign({}, c, { hidden: true }) : c)),
      `Админка: скрыта категория «${slug}»`);
  }

  async function restoreCategory(slug) {
    return commitManifest((list) => list.map((c) => (c.slug === slug ? Object.assign({}, c, { hidden: false }) : c)),
      `Админка: восстановлена категория «${slug}»`);
  }

  // ---------- запись: фразы (по одному файлу на категорию) ----------
  async function commitItems(slug, mutateFn, message) {
    const res = await global.PPOGithub.readModifyWrite(categoryPath(slug), (current) => mutateFn(current || []), message);
    if (res.ok) itemsCache[slug] = res.value;
    return res;
  }

  async function addItem(slug, text) {
    text = String(text || "").trim();
    if (!text) return { ok: false, error: "Текст фразы не может быть пустым." };
    const cat = getCategory(slug);
    return commitItems(slug, (arr) => arr.concat([text]), `Админка: добавлена фраза в «${cat ? cat.title : slug}»`);
  }

  async function editItem(slug, id, newText) {
    newText = String(newText || "").trim();
    if (!newText) return { ok: false, error: "Текст фразы не может быть пустым." };
    const idx = parseInt(id, 10);
    const cat = getCategory(slug);
    return commitItems(slug, (arr) => {
      const copy = arr.slice();
      copy[idx] = newText;
      return copy;
    }, `Админка: изменена фраза в «${cat ? cat.title : slug}»`);
  }

  async function deleteItem(slug, id) {
    const idx = parseInt(id, 10);
    const cat = getCategory(slug);
    return commitItems(slug, (arr) => {
      const copy = arr.slice();
      copy[idx] = ""; // оставляем пустую "прокладку", чтобы не портить раскладку остальных карточек
      return copy;
    }, `Админка: удалена фраза в «${cat ? cat.title : slug}»`);
  }

  function exportAll() {
    return {
      manifest: categories,
      items: itemsCache,
      exportedAt: new Date().toISOString(),
    };
  }

  global.PPOStore = {
    init,
    getAllCategories,
    getAllCategoriesIncludingHidden,
    getCategory,
    getItems,
    getRawItems,
    addCategory,
    renameCategory,
    removeCategory,
    restoreCategory,
    addItem,
    editItem,
    deleteItem,
    exportAll,
    slugify,
  };
})(window);
