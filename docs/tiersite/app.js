(function () {
  const TIERS = ["A", "B", "C+", "C", "C-", "D+", "D", "F"];
  const ROWS = [
    { type: "single", tier: "A" },
    { type: "single", tier: "B" },
    { type: "split", tiers: ["C+", "C"] },
    { type: "split", tiers: ["C-", "D+"] },
    { type: "single", tier: "D" },
    { type: "single", tier: "F" },
  ];
  const ZONES = [...TIERS, "pool"];
  const TAB_ORDER = ["1", "2", "3", "4", "5", "6", "7+"];
  const CU_RARITIES = new Set(["Common", "Uncommon"]);
  const RSRL_RARITIES = new Set(["Rare", "Super Rare", "Legendary"]);
  const STORAGE_KEY = "lorcana-tier-site-set12-v4";
  const EXPORT_VERSION = 1;
  const EXPORT_FILENAME = "lorcana-set12-tier-list.json";

  const cards = Array.isArray(window.LORCANA_SET12_CARDS) ? window.LORCANA_SET12_CARDS.slice() : [];
  const generatedSubtypeViews = Array.isArray(window.LORCANA_SET12_SUBTYPE_VIEWS)
    ? window.LORCANA_SET12_SUBTYPE_VIEWS.slice()
    : [];
  const cardsById = Object.fromEntries(cards.map((card) => [card.id, card]));
  const cardsByBucket = cards.reduce((acc, card) => {
    (acc[card.costBucket] ||= []).push(card);
    return acc;
  }, {});
  const costBuckets = TAB_ORDER.filter((bucket) => cardsByBucket[bucket]?.length);
  const BUILTIN_FILTER_VIEWS = [
    { key: "filter:items", label: "Items", type: "filter", predicate: (card) => card.type === "Item" },
    { key: "filter:songs", label: "Songs", type: "filter", predicate: (card) => card.type === "Action" && card.subtypes.includes("Song") },
    { key: "filter:actions", label: "Actions", type: "filter", predicate: (card) => card.type === "Action" && !card.subtypes.includes("Song") },
    { key: "filter:locations", label: "Locations", type: "filter", predicate: (card) => card.type === "Location" },
    { key: "filter:uninkable", label: "Uninkable", type: "filter", predicate: (card) => card.inkwell === false },
  ];
  const subtypeFilterViews = generatedSubtypeViews.map((view) => ({
    ...view,
    predicate: (card) => card.subtypes.includes(view.subtype) || (card.mentionedSubtypes || []).includes(view.subtype),
  }));
  const FILTER_VIEWS = [...BUILTIN_FILTER_VIEWS, ...subtypeFilterViews];
  const VIEW_DEFS = [
    ...costBuckets.map((bucket) => ({ key: `cost:${bucket}`, label: `Cost ${bucket}`, type: "cost", bucket })),
    ...FILTER_VIEWS.filter((view) => cards.some(view.predicate)),
  ];

  let activeViewKey = VIEW_DEFS[0]?.key || "cost:1";
  let state = normalizeState(loadState());
  let previewCardId = null;
  let statusTimeoutId = null;

  const tabsRoot = document.getElementById("tabs");
  const appRoot = document.getElementById("app");
  const resetButton = document.getElementById("reset-all");
  const exportButton = document.getElementById("export-json");
  const importButton = document.getElementById("import-json");
  const importFileInput = document.getElementById("import-file");
  const cuOnlyToggle = document.getElementById("cu-only-toggle");
  const rsrlOnlyToggle = document.getElementById("r-sr-l-only-toggle");
  const statusMessage = document.getElementById("status-message");
  const hoverPreview = createHoverPreview();
  let rarityFilterMode = "all";

  resetButton.addEventListener("click", () => {
    state = createDefaultState();
    saveState();
    render();
    setStatus("Reset all tier lists.", "success");
  });
  exportButton.addEventListener("click", exportStateToJson);
  importButton.addEventListener("click", () => importFileInput.click());
  importFileInput.addEventListener("change", handleImportFile);
  cuOnlyToggle.addEventListener("change", () => {
    setRarityFilterMode(cuOnlyToggle.checked ? "cu" : "all");
  });
  rsrlOnlyToggle.addEventListener("change", () => {
    setRarityFilterMode(rsrlOnlyToggle.checked ? "rsrl" : "all");
  });
  window.addEventListener("resize", syncPoolPanelHeight);

  render();

  function createDefaultState() {
    const nextState = {};
    for (const bucket of costBuckets) {
      nextState[bucket] = emptyBucketState();
      nextState[bucket].pool = cardsByBucket[bucket]
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((card) => card.id);
    }
    return nextState;
  }

  function emptyBucketState() {
    return Object.fromEntries(ZONES.map((zone) => [zone, []]));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function exportStateToJson() {
    const payload = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      storageKey: STORAGE_KEY,
      activeViewKey,
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = EXPORT_FILENAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Exported tier list JSON.", "success");
  }

  async function handleImportFile(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const importedState = payload && typeof payload === "object" && payload.state ? payload.state : payload;
      if (!importedState || typeof importedState !== "object") {
        throw new Error("File does not contain tier list state.");
      }

      state = normalizeState(importedState);
      const importedViewKey = payload?.activeViewKey;
      if (typeof importedViewKey === "string" && VIEW_DEFS.some((view) => view.key === importedViewKey)) {
        activeViewKey = importedViewKey;
      }
      saveState();
      render();
      setStatus(`Imported tier list from ${file.name}.`, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import tier list JSON.", "error");
    } finally {
      importFileInput.value = "";
    }
  }

  function setStatus(message, tone = "info") {
    statusMessage.textContent = message;
    statusMessage.className = "status-message";
    if (tone === "error") {
      statusMessage.classList.add("is-error");
    } else if (tone === "success") {
      statusMessage.classList.add("is-success");
    }

    if (statusTimeoutId) {
      clearTimeout(statusTimeoutId);
    }
    statusTimeoutId = window.setTimeout(() => {
      statusMessage.textContent = "";
      statusMessage.className = "status-message";
    }, 3500);
  }

  function normalizeState(rawState) {
    const normalized = {};
    const defaultState = createDefaultState();

    for (const bucket of costBuckets) {
      const validIds = new Set(cardsByBucket[bucket].map((card) => card.id));
      const seen = new Set();
      const bucketState = emptyBucketState();
      const sourceBucket = rawState?.[bucket] || defaultState[bucket];

      for (const zone of ZONES) {
        const sourceIds = Array.isArray(sourceBucket?.[zone]) ? sourceBucket[zone] : [];
        bucketState[zone] = sourceIds.filter((id) => {
          if (!validIds.has(id) || seen.has(id)) {
            return false;
          }
          seen.add(id);
          return true;
        });
      }

      const missing = cardsByBucket[bucket]
        .map((card) => card.id)
        .filter((id) => !seen.has(id))
        .sort((left, right) => cardsById[left].number - cardsById[right].number);

      bucketState.pool.push(...missing);
      normalized[bucket] = bucketState;
    }

    return normalized;
  }

  function render() {
    renderTabs();
    renderActiveBucket();
  }

  function renderTabs() {
    tabsRoot.replaceChildren();
    const costRow = document.createElement("div");
    costRow.className = "tab-row";
    const builtInFilterRow = document.createElement("div");
    builtInFilterRow.className = "tab-row";
    const subtypeFilterRow = document.createElement("div");
    subtypeFilterRow.className = "tab-row";

    for (const view of VIEW_DEFS) {
      const button = document.createElement("button");
      const count = document.createElement("span");
      button.type = "button";
      button.className = view.key === activeViewKey ? "tab-button active" : "tab-button";
      button.append(view.label);
      count.textContent = getTabCountLabel(view);
      button.appendChild(count);
      button.addEventListener("click", () => {
        activeViewKey = view.key;
        render();
      });
      if (view.type === "cost") {
        costRow.appendChild(button);
      } else if (view.subtype) {
        subtypeFilterRow.appendChild(button);
      } else {
        builtInFilterRow.appendChild(button);
      }
    }

    tabsRoot.appendChild(costRow);
    if (builtInFilterRow.childElementCount > 0) {
      tabsRoot.appendChild(builtInFilterRow);
    }
    if (subtypeFilterRow.childElementCount > 0) {
      tabsRoot.appendChild(subtypeFilterRow);
    }
  }

  function renderActiveBucket() {
    const view = getActiveView();
    const visibleState = getVisibleState(view);
    const viewCount = getViewCardCount(view);
    const renderedCount = getRenderedViewCount(view);

    const meta = document.createElement("section");
    meta.className = "tab-meta";
    meta.append(
      createMetaCount(viewCount, renderedCount, view.label),
      createMetaText("Bottom-right numbers show how far a character is above or below that cost's vanilla stat line."),
      createMetaText("Hover a thumbnail to magnify it, then drag it into place.")
    );

    const board = document.createElement("section");
    board.className = "tier-board";

    const showEmptyTierHint = visibleState.pool.length > 0;
    for (const rowDef of ROWS) {
      if (rowDef.type === "split") {
        board.appendChild(createSplitTierRow(rowDef.tiers, visibleState, showEmptyTierHint, view));
      } else {
        board.appendChild(createTierRow(rowDef.tier, visibleState[rowDef.tier], showEmptyTierHint, view));
      }
    }

    const pool = document.createElement("section");
    pool.className = "pool-panel";
    pool.appendChild(createPoolPanel(visibleState.pool, view));

    const layout = document.createElement("section");
    layout.className = "board-layout";
    layout.append(board, pool);

    appRoot.replaceChildren(meta, layout);
    requestAnimationFrame(syncPoolPanelHeight);
  }

  function syncPoolPanelHeight() {
    const board = document.querySelector(".tier-board");
    const pool = document.querySelector(".pool-panel");
    if (!board || !pool) {
      return;
    }

    if (window.innerWidth <= 900) {
      pool.style.height = "";
      return;
    }

    pool.style.height = `${board.offsetHeight}px`;
  }

  function createTierRow(tier, cardIds, showEmptyHint, view) {
    const row = document.createElement("div");
    row.className = "tier-row";

    const badge = document.createElement("div");
    badge.className = "tier-badge";
    badge.dataset.tier = tier;
    badge.textContent = tier;

    row.append(badge, createTrack(tier, cardIds, view, { showEmptyHint }));
    return row;
  }

  function createSplitTierRow(tiers, bucketState, showEmptyHint, view) {
    const row = document.createElement("div");
    row.className = "tier-row tier-row-split";

    const badgeGroup = document.createElement("div");
    badgeGroup.className = "tier-badge-stack";
    for (const tier of tiers) {
      const badge = document.createElement("div");
      badge.className = "tier-badge tier-badge-split";
      badge.dataset.tier = tier;
      badge.textContent = tier;
      badgeGroup.appendChild(badge);
    }

    const trackGroup = document.createElement("div");
    trackGroup.className = "split-track-group";
    for (const tier of tiers) {
      trackGroup.appendChild(createTrack(tier, bucketState[tier], view, { showEmptyHint, className: "split-card-track" }));
    }

    row.append(badgeGroup, trackGroup);
    return row;
  }

  function createPoolPanel(cardIds, view) {
    const wrapper = document.createElement("div");
    const header = document.createElement("div");
    const title = document.createElement("div");
    const note = document.createElement("div");
    wrapper.className = "pool-content";
    header.className = "pool-header";
    title.className = "pool-title";
    title.textContent = "Untiered Pool";
    note.className = "pool-note";
    note.textContent = `${cardIds.length} card${cardIds.length === 1 ? "" : "s"} remaining`;
    header.append(title, note);
    wrapper.appendChild(header);
    wrapper.appendChild(createTrack("pool", cardIds, view, { showEmptyHint: true }));
    return wrapper;
  }

  function createTrack(zone, cardIds, view, options = {}) {
    const { showEmptyHint = true } = options;
    const track = document.createElement("div");
    track.className = zone === "pool" ? "card-track pool-track" : "card-track";
    if (options.className) {
      track.classList.add(options.className);
    }
    track.dataset.zone = zone;

    for (const cardId of cardIds) {
      track.appendChild(createCard(cardId, view));
    }

    if (!cardIds.length && showEmptyHint) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = zone === "pool" ? "Drag cards here to remove them from tiers." : "Drop cards here.";
      track.appendChild(empty);
    }

    track.addEventListener("dragover", handleTrackDragOver);
    track.addEventListener("dragenter", () => track.classList.add("drag-target"));
    track.addEventListener("dragleave", (event) => {
      if (!track.contains(event.relatedTarget)) {
        track.classList.remove("drag-target");
      }
    });
    track.addEventListener("drop", handleTrackDrop);

    return track;
  }

  function createCard(cardId, view) {
    const card = cardsById[cardId];
    const deltaLabel = formatParDelta(card.parDelta);
    const article = document.createElement("article");
    const image = document.createElement("img");
    article.className = "card";
    if (isSubtypeMentionCard(view, card)) {
      article.classList.add("is-subtype-mention");
    }
    article.draggable = true;
    article.dataset.cardId = card.id;
    article.title = `${card.name}\nCost ${card.cost} • ${card.rarity}`;
    image.src = card.thumbnail;
    image.alt = card.name;
    article.appendChild(image);
    if (deltaLabel) {
      const deltaBadge = document.createElement("div");
      deltaBadge.className = `card-delta ${deltaClassName(card.parDelta)}`;
      deltaBadge.textContent = deltaLabel;
      article.appendChild(deltaBadge);
    }

    article.addEventListener("mouseenter", (event) => {
      if (document.body.classList.contains("is-dragging")) {
        return;
      }
      showHoverPreview(card, event);
    });
    article.addEventListener("mousemove", (event) => {
      if (previewCardId === card.id) {
        updateHoverPreviewPosition(event);
      }
    });
    article.addEventListener("mouseleave", () => {
      if (previewCardId === card.id) {
        hideHoverPreview();
      }
    });
    article.addEventListener("dragstart", (event) => {
      hideHoverPreview();
      document.body.classList.add("is-dragging");
      article.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.id);
    });

    article.addEventListener("dragend", () => {
      document.body.classList.remove("is-dragging");
      article.classList.remove("dragging");
      document.querySelectorAll(".card-track").forEach((track) => track.classList.remove("drag-target"));
      syncStateFromDom();
      saveState();
      renderActiveBucket();
    });

    return article;
  }

  function createHoverPreview() {
    const preview = document.createElement("div");
    const image = document.createElement("img");
    preview.className = "hover-preview";
    image.alt = "";
    preview.appendChild(image);
    document.body.appendChild(preview);
    return preview;
  }

  function showHoverPreview(card, event) {
    previewCardId = card.id;
    const image = hoverPreview.querySelector("img");
    image.src = card.thumbnail;
    image.alt = card.name;
    hoverPreview.classList.toggle("is-location", card.type === "Location");
    updateHoverPreviewPosition(event);
    hoverPreview.classList.add("visible");
  }

  function updateHoverPreviewPosition(event) {
    const isLocation = hoverPreview.classList.contains("is-location");
    const imageWidth = isLocation ? 448 : 320;
    const imageHeight = isLocation ? 320 : 448;
    const gap = 20;
    let left = event.clientX + gap;
    let top = event.clientY - imageHeight / 2;

    if (left + imageWidth > window.innerWidth - 12) {
      left = event.clientX - imageWidth - gap;
    }
    if (left < 12) {
      left = 12;
    }
    if (top < 12) {
      top = 12;
    }
    if (top + imageHeight > window.innerHeight - 12) {
      top = window.innerHeight - imageHeight - 12;
    }

    hoverPreview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function hideHoverPreview() {
    previewCardId = null;
    hoverPreview.classList.remove("is-location");
    hoverPreview.classList.remove("visible");
  }

  function handleTrackDragOver(event) {
    event.preventDefault();

    const track = event.currentTarget;
    const draggingCard = document.querySelector(".card.dragging");
    if (!draggingCard) {
      return;
    }

    removeEmptyState(track);
    const afterElement = getAfterElement(track, event.clientX, event.clientY);
    if (afterElement) {
      track.insertBefore(draggingCard, afterElement);
    } else {
      track.appendChild(draggingCard);
    }
  }

  function handleTrackDrop(event) {
    event.preventDefault();
    const track = event.currentTarget;
    track.classList.remove("drag-target");
    syncStateFromDom();
    saveState();
    renderActiveBucket();
  }

  function syncStateFromDom() {
    const view = getActiveView();
    if (view.type === "filter") {
      syncFilterViewState(view);
      return;
    }

    const bucket = view.bucket;
    const nextBucketState = emptyBucketState();
    const validIds = new Set(cardsByBucket[bucket].map((card) => card.id));
    preserveHiddenCards(nextBucketState, state[bucket], (id) => validIds.has(id) && !isRarityVisible(cardsById[id]));
    const visibleIds = new Set(
      cardsByBucket[bucket]
        .map((card) => card.id)
        .filter((id) => isRarityVisible(cardsById[id]))
    );

    document.querySelectorAll(".card-track").forEach((track) => {
      const zone = track.dataset.zone;
      nextBucketState[zone].push(
        ...Array.from(track.querySelectorAll(".card"))
        .map((card) => card.dataset.cardId)
        .filter((id, index, ids) => visibleIds.has(id) && ids.indexOf(id) === index)
      );
    });

    const missing = [...visibleIds]
      .filter((id) => !ZONES.some((zone) => nextBucketState[zone].includes(id)))
      .sort((left, right) => cardsById[left].number - cardsById[right].number);

    nextBucketState.pool.push(...missing);
    state[bucket] = nextBucketState;
  }

  function syncFilterViewState(view) {
    const filteredIds = new Set(cards.filter(view.predicate).map((card) => card.id));
    const visibleFilteredIds = new Set([...filteredIds].filter((id) => isRarityVisible(cardsById[id])));
    const nextState = {};

    for (const bucket of costBuckets) {
      nextState[bucket] = {};
      for (const zone of ZONES) {
        nextState[bucket][zone] = state[bucket][zone].filter((id) => !filteredIds.has(id));
      }
      preserveHiddenCards(nextState[bucket], state[bucket], (id) => filteredIds.has(id) && !visibleFilteredIds.has(id));
    }

    const assigned = new Set();
    document.querySelectorAll(".card-track").forEach((track) => {
      const zone = track.dataset.zone;
      const ids = Array.from(track.querySelectorAll(".card"))
        .map((card) => card.dataset.cardId)
        .filter((id) => visibleFilteredIds.has(id) && !assigned.has(id));

      for (const id of ids) {
        assigned.add(id);
        nextState[cardsById[id].costBucket][zone].push(id);
      }
    });

    for (const bucket of costBuckets) {
      const visibleBucketIds = cardsByBucket[bucket]
        .filter(view.predicate)
        .filter(isRarityVisible)
        .map((card) => card.id);
      const bucketAssigned = new Set(ZONES.flatMap((zone) => nextState[bucket][zone]).filter((id) => filteredIds.has(id)));
      const missing = visibleBucketIds
        .filter((id) => !bucketAssigned.has(id))
        .sort((left, right) => cardsById[left].number - cardsById[right].number);
      nextState[bucket].pool.push(...missing);
    }

    state = normalizeState(nextState);
  }

  function removeEmptyState(track) {
    track.querySelector(".empty-state")?.remove();
  }

  function getAfterElement(track, x, y) {
    const cardsInTrack = [...track.querySelectorAll(".card:not(.dragging)")]
      .map((card) => ({ card, rect: card.getBoundingClientRect() }))
      .sort((left, right) => {
        const topDelta = left.rect.top - right.rect.top;
        if (Math.abs(topDelta) > 8) {
          return topDelta;
        }
        return left.rect.left - right.rect.left;
      });

    if (!cardsInTrack.length) {
      return null;
    }

    const rows = [];
    for (const item of cardsInTrack) {
      const currentRow = rows.at(-1);
      if (!currentRow || Math.abs(item.rect.top - currentRow.top) > 8) {
        rows.push({
          top: item.rect.top,
          bottom: item.rect.bottom,
          items: [item],
        });
        continue;
      }

      currentRow.bottom = Math.max(currentRow.bottom, item.rect.bottom);
      currentRow.items.push(item);
    }

    const targetRowIndex = rows.findIndex((row, index) => {
      const nextRow = rows[index + 1];
      const boundary = nextRow ? row.bottom + (nextRow.top - row.bottom) / 2 : Number.POSITIVE_INFINITY;
      return y <= boundary;
    });

    if (targetRowIndex === -1) {
      return null;
    }

    const targetRow = rows[targetRowIndex];
    for (const item of targetRow.items) {
      if (x < item.rect.left + item.rect.width / 2) {
        return item.card;
      }
    }

    return rows[targetRowIndex + 1]?.items[0]?.card ?? null;
  }

  function formatParDelta(value) {
    if (typeof value !== "number") {
      return "";
    }
    if (value > 0) {
      return `+${value}`;
    }
    return `${value}`;
  }

  function deltaClassName(value) {
    if (typeof value !== "number" || value === 0) {
      return "is-neutral";
    }
    return value > 0 ? "is-positive" : "is-negative";
  }

  function getActiveView() {
    return VIEW_DEFS.find((view) => view.key === activeViewKey) || VIEW_DEFS[0];
  }

  function getViewCardCount(view) {
    if (view.type === "cost") {
      return cardsByBucket[view.bucket]?.length || 0;
    }
    return cards.filter(view.predicate).length;
  }

  function getTabCountLabel(view) {
    if (view.subtype) {
      const subtypeCount = cards.filter((card) => card.subtypes.includes(view.subtype)).length;
      const mentionOnlyCount = cards.filter(
        (card) => !card.subtypes.includes(view.subtype) && (card.mentionedSubtypes || []).includes(view.subtype)
      ).length;
      return `${subtypeCount}/${mentionOnlyCount}`;
    }

    return `${getViewCardCount(view)} cards`;
  }

  function getRenderedViewCount(view) {
    if (rarityFilterMode === "all") {
      return getViewCardCount(view);
    }
    return getViewCards(view).filter(isRarityVisible).length;
  }

  function getVisibleState(view) {
    const visibleState = emptyBucketState();
    const sourceBuckets = view.type === "cost" ? [view.bucket] : costBuckets;

    for (const bucket of sourceBuckets) {
      for (const zone of ZONES) {
        for (const id of state[bucket][zone]) {
          if (cardMatchesRenderedView(view, cardsById[id])) {
            visibleState[zone].push(id);
          }
        }
      }
    }

    return visibleState;
  }

  function getViewCards(view) {
    if (view.type === "cost") {
      return cardsByBucket[view.bucket] || [];
    }
    return cards.filter(view.predicate);
  }

  function cardMatchesRenderedView(view, card) {
    if (!cardMatchesView(view, card)) {
      return false;
    }
    return isRarityVisible(card);
  }

  function cardMatchesView(view, card) {
    return view.type === "cost" ? card.costBucket === view.bucket : view.predicate(card);
  }

  function isSubtypeMentionCard(view, card) {
    return Boolean(view?.subtype) && (card.mentionedSubtypes || []).includes(view.subtype);
  }

  function isRarityVisible(card) {
    if (rarityFilterMode === "cu") {
      return CU_RARITIES.has(card.rarity);
    }
    if (rarityFilterMode === "rsrl") {
      return RSRL_RARITIES.has(card.rarity);
    }
    return true;
  }

  function preserveHiddenCards(nextBucketState, sourceBucketState, predicate) {
    for (const zone of ZONES) {
      nextBucketState[zone].push(...sourceBucketState[zone].filter(predicate));
    }
  }

  function createMetaText(text) {
    const node = document.createElement("div");
    node.textContent = text;
    return node;
  }

  function createMetaCount(viewCount, renderedCount, viewLabel) {
    const node = document.createElement("div");
    node.append("Showing ");
    if (rarityFilterMode !== "all") {
      node.append(createStrongText(renderedCount), " of ", createStrongText(viewCount), " cards in ", createStrongText(viewLabel), ".");
    } else {
      node.append(createStrongText(viewCount), " cards in ", createStrongText(viewLabel), ".");
    }
    return node;
  }

  function createStrongText(value) {
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    return strong;
  }

  function setRarityFilterMode(mode) {
    rarityFilterMode = mode;
    cuOnlyToggle.checked = mode === "cu";
    rsrlOnlyToggle.checked = mode === "rsrl";
    render();
  }
})();
