/*
 * PPO Sync — подключается к оригинальной вёрстке сайта и подставляет в неё
 * актуальные данные из репозитория (data/manifest.json + data/categories/*.json).
 * Визуально ничего не перестраивает: у каждого блока категории уже есть
 * id="data-block-<slug>", здесь только обновляется список .data__item внутри
 * его собственного .data__content — включая пустые "прокладки" между
 * группами карточек, они специально сохраняются, чтобы сетка не съезжала.
 *
 * Этот скрипт подключён и выполняется ДО scripts/script.js, поэтому поиск,
 * копирование и раскрытие категорий из оригинального скрипта продолжают
 * работать как раньше — они просто видят уже готовые данные.
 */
(function () {
  "use strict";

  function ownDataContent(block) {
    var content = block.querySelector(":scope > div.content");
    if (!content) return null;
    var wrapper = content.querySelector(":scope > div.wrapper");
    if (!wrapper) return null;
    return wrapper.querySelector(":scope > div.data__content");
  }

  function rebuildCategory(slug) {
    var block = document.getElementById("data-block-" + slug);
    if (!block) return;
    var dataContent = ownDataContent(block);
    if (!dataContent) return;

    Array.prototype.slice.call(dataContent.children).forEach(function (child) {
      if (child.matches && child.matches("div.data__item")) {
        dataContent.removeChild(child);
      }
    });

    // ВАЖНО: берём "сырые" данные (с пустыми "прокладками"), не getItems().
    var rawItems = window.PPOStore.getRawItems(slug);
    var frag = document.createDocumentFragment();
    rawItems.forEach(function (text) {
      var div = document.createElement("div");
      div.className = "data__item";
      var span = document.createElement("span");
      span.className = "data__item-text";
      if (text) span.textContent = text;
      div.appendChild(span);
      frag.appendChild(div);
    });
    dataContent.insertBefore(frag, dataContent.firstChild);
  }

  function rebuildAll() {
    window.PPOStore.getAllCategoriesIncludingHidden().forEach(function (cat) {
      rebuildCategory(cat.slug);
    });
  }

  function updateFooterAuthPill() {
    var label = document.getElementById("ppoAuthPillLabel");
    if (!label || !window.PPOAuth) return;
    var user = window.PPOAuth.currentUser();
    label.textContent = user ? user.username + " · Админка" : "Войти";
  }

  // Оригинальный scripts/script.js навешивает клик-копирование на карточки
  // .data__item ОДИН раз, в момент DOMContentLoaded — по снимку узлов на тот
  // момент. Так как наши данные подгружаются асинхронно (fetch), к моменту,
  // когда они придут, мы заменяем узлы внутри категорий на новые — и старые
  // обработчики клика на них, соответственно, теряются вместе со старыми
  // узлами. Чтобы копирование по клику не переставало работать, вешаем то же
  // самое поведение через делегирование на document — оно само переживает
  // любую последующую перестройку DOM.
  function bindClickToCopyDelegated() {
    document.addEventListener("click", function (e) {
      var item = e.target.closest(".data__item");
      if (!item) return;
      var textEl = item.querySelector(".data__item-text") || item.querySelector(".data__item-text1");
      if (!textEl) return;
      navigator.clipboard.writeText(textEl.innerText).catch(function () {});
      document.querySelectorAll(".data__item--active").forEach(function (el) {
        el.classList.remove("data__item--active");
      });
      item.classList.add("data__item--active");
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindClickToCopyDelegated();
    Promise.all([window.PPOStore.init(), window.PPOAuth.init()])
      .then(function () {
        rebuildAll();
        updateFooterAuthPill();
      })
      .catch(function (e) {
        console.error("PPO: не удалось загрузить данные из репозитория:", e);
      });
  });
})();
