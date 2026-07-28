(function () {
  const COST_BUCKETS = ["1", "2", "3", "4", "5", "6", "7+"];
  const CU_RARITIES = new Set(["Common", "Uncommon"]);
  const RSRL_RARITIES = new Set(["Rare", "Super Rare", "Legendary"]);
  const SELECTED_SET_STORAGE_KEY = "lorcana-analysis-site-selected-set-v1";
  const TOP_TABS = [
    { key: "cost", label: "Cost" },
    { key: "type", label: "Type" },
    { key: "characteristic", label: "Characteristics" },
    { key: "keyword", label: "Keywords" },
    { key: "reference", label: "References" },
    { key: "other", label: "Other" },
  ];

  const manifest = window.LORCANA_TIER_SITE_MANIFEST;
  const topTabsRoot = document.getElementById("top-tabs");
  const optionTabsRoot = document.getElementById("option-tabs");
  const appRoot = document.getElementById("app");
  const setSelector = document.getElementById("set-selector");
  const setEyebrow = document.getElementById("set-eyebrow");
  const pageTitle = document.getElementById("page-title");
  const pageSubhead = document.getElementById("page-subhead");
  const hideStatLinesToggle = document.getElementById("hide-stat-lines-toggle");
  const cuOnlyToggle = document.getElementById("cu-only-toggle");
  const rsrlOnlyToggle = document.getElementById("r-sr-l-only-toggle");
  const hoverPreview = createHoverPreview();
  const assetPromises = new Map();

  let currentSetMeta = null;
  let cards = [];
  let viewsByCategory = {};
  let activeCategory = "cost";
  let activeViewKey = "cost:1";
  let rarityFilterMode = "all";
  let hideStatLines = false;
  let loadRequestToken = 0;

  if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) {
    renderAppMessage("No supported sets were generated for this site.", true);
    return;
  }

  bindEvents();
  populateSetSelector();
  renderAppMessage("Loading set data…");
  void switchSet(resolveInitialSetId());

  function bindEvents() {
    setSelector.addEventListener("change", () => void switchSet(setSelector.value));
    hideStatLinesToggle.addEventListener("change", () => {
      hideStatLines = hideStatLinesToggle.checked;
      renderCards();
    });
    cuOnlyToggle.addEventListener("change", () => setRarityFilterMode(cuOnlyToggle.checked ? "cu" : "all"));
    rsrlOnlyToggle.addEventListener("change", () => setRarityFilterMode(rsrlOnlyToggle.checked ? "rsrl" : "all"));
  }

  function populateSetSelector() {
    for (const setMeta of manifest.sets) {
      const option = document.createElement("option");
      option.value = setMeta.id;
      option.textContent = `Set ${setMeta.number} — ${setMeta.name}`;
      setSelector.appendChild(option);
    }
  }

  function resolveInitialSetId() {
    const requested = new URLSearchParams(window.location.search).get("set");
    if (requested && getSetMeta(requested)) return requested;
    const persisted = localStorage.getItem(SELECTED_SET_STORAGE_KEY);
    return getSetMeta(persisted) ? persisted : manifest.defaultSetId || manifest.sets.at(-1).id;
  }

  async function switchSet(setId) {
    const setMeta = getSetMeta(setId) || manifest.sets[0];
    const requestToken = ++loadRequestToken;
    setSelector.disabled = true;
    renderAppMessage(`Loading ${setMeta.name}…`);
    try {
      const payload = await loadSetPayload(setMeta);
      if (requestToken !== loadRequestToken) return;
      currentSetMeta = payload.meta || setMeta;
      cards = Array.isArray(payload.cards) ? payload.cards : [];
      viewsByCategory = buildViews(cards);
      activeCategory = "cost";
      activeViewKey = viewsByCategory.cost[0]?.key || "";
      rarityFilterMode = "all";
      cuOnlyToggle.checked = false;
      rsrlOnlyToggle.checked = false;
      updatePageCopy();
      updateSelectedSetState();
      render();
    } catch (error) {
      renderAppMessage(error instanceof Error ? error.message : "Failed to load set data.", true);
    } finally {
      setSelector.disabled = false;
    }
  }

  function getSetMeta(setId) {
    return manifest.sets.find((setMeta) => setMeta.id === setId) || null;
  }

  function loadSetPayload(setMeta) {
    const loaded = window.LORCANA_TIER_SITE_SETS?.[setMeta.id];
    if (loaded) return Promise.resolve(loaded);
    if (assetPromises.has(setMeta.id)) return assetPromises.get(setMeta.id);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `../tiersite/${setMeta.asset}`;
      script.async = true;
      script.onload = () => {
        const payload = window.LORCANA_TIER_SITE_SETS?.[setMeta.id];
        if (payload) resolve(payload);
        else reject(new Error(`Loaded ${setMeta.asset} but no set payload was registered.`));
      };
      script.onerror = () => reject(new Error(`Failed to load ${setMeta.asset}.`));
      document.body.appendChild(script);
    });
    assetPromises.set(setMeta.id, promise);
    return promise;
  }

  function updatePageCopy() {
    setEyebrow.textContent = `Lorcana Set ${currentSetMeta.number}`;
    pageTitle.textContent = `${currentSetMeta.name} Analysis`;
    pageSubhead.textContent = `Explore ${currentSetMeta.name} by cost, type, characteristics, keywords, and ability references.`;
    document.title = `Lorcana Set ${currentSetMeta.number} Analysis · ${currentSetMeta.name}`;
  }

  function updateSelectedSetState() {
    localStorage.setItem(SELECTED_SET_STORAGE_KEY, currentSetMeta.id);
    setSelector.value = currentSetMeta.id;
    const url = new URL(window.location.href);
    url.searchParams.set("set", currentSetMeta.id);
    window.history.replaceState({}, "", url);
  }

  function buildViews(setCards) {
    const subtypes = uniqueSorted(setCards.flatMap((card) => card.subtypes || []));
    const keywords = uniqueSorted(setCards.flatMap((card) => getKeywords(card)));
    const referenceTerms = uniqueSorted([...subtypes, ...keywords]).filter((term) =>
      setCards.some((card) => getEffects(card).some((effect) => matchesTerm(effect, term)))
    );
    return {
      cost: COST_BUCKETS.map((bucket) => view(`cost:${bucket}`, `${bucket} cost`, (card) => card.costBucket === bucket)),
      type: [
        view("type:characters", "Characters", (card) => card.type === "Character"),
        view("type:items", "Items", (card) => card.type === "Item"),
        view("type:songs", "Songs", (card) => card.type === "Action" && (card.subtypes || []).includes("Song")),
        view("type:actions", "Actions", (card) => card.type === "Action" && !(card.subtypes || []).includes("Song")),
        view("type:locations", "Locations", (card) => card.type === "Location"),
        view("type:vanillas", "Vanillas", (card) => card.type === "Character" && card.fullText === "" && card.inkwell !== false),
        view("type:uninkable", "Uninkable", (card) => card.inkwell === false),
      ],
      characteristic: subtypes.map((subtype) => view(`characteristic:${subtype}`, subtype, (card) => (card.subtypes || []).includes(subtype))),
      keyword: keywords.map((keyword) => view(`keyword:${keyword}`, keyword, (card) => getKeywords(card).includes(keyword))),
      reference: referenceTerms.map((term) => view(`reference:${term}`, term, (card) => getEffects(card).some((effect) => matchesTerm(effect, term)))),
      other: [
        view("other:removal", "Removal", (card) => getEffects(card).some(isCharacterRemovalEffect)),
        view("other:draw", "Draw", (card) => getEffects(card).some(isDrawEffect)),
      ],
    };
  }

  function view(key, label, predicate) {
    return { key, label, predicate };
  }

  function uniqueSorted(values) {
    return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))].sort((left, right) => left.localeCompare(right));
  }

  function getKeywords(card) {
    return uniqueSorted((card.abilities || []).map((ability) => ability.keyword).filter(Boolean));
  }

  function getEffects(card) {
    return [
      ...(card.effects || []),
      ...(card.abilities || []).map((ability) => ability.effect).filter(Boolean),
    ];
  }

  function matchesTerm(text, term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const plural = term.replace(/y$/i, "ies").replace(/(?<!y)$/i, "s");
    const pluralEscaped = plural.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(^|[^a-z0-9])(?:${escaped}|${pluralEscaped})(?=$|[^a-z0-9])`, "i").test(text);
  }

  function isCharacterRemovalEffect(effect) {
    return [
      /\bbanish\b/i,
      /\bmove\s+\d+\s+damage\b/i,
      /\bdeal\s+\d+\s+damage\b/i,
      /\breturn\b[^.]*\bto\b[^.]*\bplayer'?s\s+hand\b/i,
    ].some((pattern) => pattern.test(effect)) || hasNonDeckInkwellEffect(effect);
  }

  function hasNonDeckInkwellEffect(effect) {
    return [...effect.matchAll(/\bput\s+((?:(?!\bput\b|[.])[\s\S])+?)\s+into\b[^.]*\binkwell\b/gi)]
      .some((match) => !/\b(?:the\s+)?top\s+(?:\d+\s+)?cards?\b/i.test(match[1]));
  }

  function isDrawEffect(effect) {
    return /\bdraws?\s+(?:a|\d+)\s+cards?\b/i.test(effect);
  }

  function render() {
    renderTopTabs();
    renderOptionTabs();
    renderCards();
  }

  function renderTopTabs() {
    topTabsRoot.replaceChildren();
    for (const category of TOP_TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = category.key === activeCategory ? "top-tab active" : "top-tab";
      button.textContent = category.label;
      button.addEventListener("click", () => {
        activeCategory = category.key;
        activeViewKey = viewsByCategory[activeCategory][0]?.key || "";
        render();
      });
      topTabsRoot.appendChild(button);
    }
  }

  function renderOptionTabs() {
    optionTabsRoot.replaceChildren();
    for (const currentView of viewsByCategory[activeCategory]) {
      const button = document.createElement("button");
      const count = cards.filter(currentView.predicate).length;
      button.type = "button";
      button.className = currentView.key === activeViewKey ? "option-tab active" : "option-tab";
      button.append(currentView.label);
      const countNode = document.createElement("span");
      countNode.textContent = `(${count})`;
      button.appendChild(countNode);
      button.addEventListener("click", () => {
        activeViewKey = currentView.key;
        renderOptionTabs();
        renderCards();
      });
      optionTabsRoot.appendChild(button);
    }
  }

  function renderCards() {
    const selectedView = viewsByCategory[activeCategory].find((currentView) => currentView.key === activeViewKey);
    const matchingCards = selectedView ? cards.filter(selectedView.predicate) : [];
    const visibleCards = matchingCards.filter(isRarityVisible);
    const meta = document.createElement("section");
    meta.className = "analysis-meta";
    meta.append(createCount(matchingCards.length, visibleCards.length, selectedView?.label || "this view"));
    if (!hideStatLines) meta.append(createText("Bottom-right numbers show a character's delta from its cost's vanilla stat line."));

    const panel = document.createElement("section");
    panel.className = "cards-panel";
    const grid = document.createElement("div");
    grid.className = "card-grid";
    for (const card of visibleCards) grid.appendChild(createCard(card));
    if (!visibleCards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No cards match these filters.";
      grid.appendChild(empty);
    }
    panel.appendChild(grid);
    appRoot.replaceChildren(meta, panel);
  }

  function createCount(total, visible, label) {
    const node = document.createElement("div");
    node.append("Showing ", strong(visible));
    if (visible !== total) node.append(" of ", strong(total));
    node.append(" cards in ", strong(label), ".");
    return node;
  }

  function strong(value) {
    const node = document.createElement("strong");
    node.textContent = String(value);
    return node;
  }

  function createText(text) {
    const node = document.createElement("div");
    node.textContent = text;
    return node;
  }

  function createCard(card) {
    const article = document.createElement("article");
    const image = document.createElement("img");
    article.className = "card";
    article.title = `${card.name}\nCost ${card.cost} • ${card.rarity}`;
    image.src = card.thumbnail;
    image.alt = card.name;
    article.appendChild(image);
    if (!hideStatLines && typeof card.parDelta === "number") {
      const badge = document.createElement("div");
      badge.className = `card-delta ${card.parDelta > 0 ? "is-positive" : card.parDelta < 0 ? "is-negative" : ""}`;
      badge.textContent = card.parDelta > 0 ? `+${card.parDelta}` : String(card.parDelta);
      article.appendChild(badge);
    }
    article.addEventListener("mouseenter", (event) => showHoverPreview(card, event));
    article.addEventListener("mousemove", (event) => updateHoverPreviewPosition(event));
    article.addEventListener("mouseleave", hideHoverPreview);
    return article;
  }

  function createHoverPreview() {
    const preview = document.createElement("div");
    const image = document.createElement("img");
    preview.className = "hover-preview";
    preview.appendChild(image);
    document.body.appendChild(preview);
    return preview;
  }

  function showHoverPreview(card, event) {
    const image = hoverPreview.querySelector("img");
    image.src = card.thumbnail;
    image.alt = card.name;
    hoverPreview.classList.toggle("is-location", card.type === "Location");
    updateHoverPreviewPosition(event);
    hoverPreview.classList.add("visible");
  }

  function updateHoverPreviewPosition(event) {
    const isLocation = hoverPreview.classList.contains("is-location");
    const width = isLocation ? 448 : 320;
    const height = isLocation ? 320 : 448;
    const gap = 20;
    let left = event.clientX + gap;
    let top = event.clientY - height / 2;
    if (left + width > window.innerWidth - 12) left = event.clientX - width - gap;
    left = Math.max(12, left);
    top = Math.max(12, Math.min(top, window.innerHeight - height - 12));
    hoverPreview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function hideHoverPreview() {
    hoverPreview.classList.remove("is-location", "visible");
  }

  function isRarityVisible(card) {
    return rarityFilterMode === "cu" ? CU_RARITIES.has(card.rarity) : rarityFilterMode === "rsrl" ? RSRL_RARITIES.has(card.rarity) : true;
  }

  function setRarityFilterMode(mode) {
    rarityFilterMode = mode;
    cuOnlyToggle.checked = mode === "cu";
    rsrlOnlyToggle.checked = mode === "rsrl";
    renderCards();
  }

  function renderAppMessage(message, isError = false) {
    const notice = document.createElement("section");
    notice.className = isError ? "app-message is-error" : "app-message";
    notice.textContent = message;
    appRoot.replaceChildren(notice);
  }
})();
