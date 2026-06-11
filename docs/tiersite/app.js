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
  const STORAGE_KEY_VERSION = 5;
  const STORAGE_ENTRY_VERSION = 2;
  const EXPORT_VERSION = 3;
  const SELECTED_SET_STORAGE_KEY = "lorcana-tier-site-selected-set-v1";
  const LEGACY_DEFAULT_SET_ID = "12";
  const ALL_SETS_EXPORT_FILENAME = "lorcana-tier-lists-all-sets.json";
  const BUILTIN_FILTER_VIEWS = [
    { key: "filter:items", label: "Items", type: "filter", predicate: (card) => card.type === "Item" },
    { key: "filter:songs", label: "Songs", type: "filter", predicate: (card) => card.type === "Action" && card.subtypes.includes("Song") },
    { key: "filter:actions", label: "Actions", type: "filter", predicate: (card) => card.type === "Action" && !card.subtypes.includes("Song") },
    { key: "filter:locations", label: "Locations", type: "filter", predicate: (card) => card.type === "Location" },
    { key: "filter:uninkable", label: "Uninkable", type: "filter", predicate: (card) => card.inkwell === false },
  ];

  const manifest = window.LORCANA_TIER_SITE_MANIFEST;
  const tabsRoot = document.getElementById("tabs");
  const appRoot = document.getElementById("app");
  const resetButton = document.getElementById("reset-tier");
  const resetAllButton = document.getElementById("reset-all-tiers");
  const exportButton = document.getElementById("export-json");
  const importButton = document.getElementById("import-json");
  const importFileInput = document.getElementById("import-file");
  const cuOnlyToggle = document.getElementById("cu-only-toggle");
  const rsrlOnlyToggle = document.getElementById("r-sr-l-only-toggle");
  const statusMessage = document.getElementById("status-message");
  const setSelector = document.getElementById("set-selector");
  const setEyebrow = document.getElementById("set-eyebrow");
  const pageTitle = document.getElementById("page-title");
  const pageSubhead = document.getElementById("page-subhead");
  const hoverPreview = createHoverPreview();

  let currentSetMeta = null;
  let currentRuntime = null;
  let cards = [];
  let generatedSubtypeViews = [];
  let cardsById = {};
  let cardsByBucket = {};
  let costBuckets = [];
  let FILTER_VIEWS = [];
  let VIEW_DEFS = [];
  let activeViewKey = "cost:1";
  let state = {};
  let previewCardId = null;
  let statusTimeoutId = null;
  let rarityFilterMode = "all";
  let loadRequestToken = 0;

  const setAssetPromises = new Map();

  if (!manifest || !Array.isArray(manifest.sets) || !manifest.sets.length) {
    renderAppMessage("No supported sets were generated for this site.", true);
    disableControls(true);
    return;
  }

  bindEvents();
  populateSetSelector();
  renderAppMessage("Loading set data…");
  void switchSet(resolveInitialSetId(), { replaceHistory: true, showStatus: false });

  function bindEvents() {
    resetButton.addEventListener("click", () => {
      state = createDefaultState();
      saveState();
      render();
      setStatus(`Reset tier placements for ${currentSetMeta.name}.`, "success");
    });
    resetAllButton.addEventListener("click", () => {
      resetAllTierPlacements();
    });
    exportButton.addEventListener("click", () => {
      void exportStateToJson();
    });
    importButton.addEventListener("click", () => importFileInput.click());
    importFileInput.addEventListener("change", handleImportFile);
    cuOnlyToggle.addEventListener("change", () => {
      setRarityFilterMode(cuOnlyToggle.checked ? "cu" : "all");
    });
    rsrlOnlyToggle.addEventListener("change", () => {
      setRarityFilterMode(rsrlOnlyToggle.checked ? "rsrl" : "all");
    });
    setSelector.addEventListener("change", () => {
      void switchSet(setSelector.value, { replaceHistory: true, showStatus: true });
    });
    window.addEventListener("resize", syncPoolPanelHeight);
  }

  function populateSetSelector() {
    setSelector.replaceChildren();
    for (const setMeta of manifest.sets) {
      const option = document.createElement("option");
      option.value = setMeta.id;
      option.textContent = `Set ${setMeta.number} — ${setMeta.name}`;
      setSelector.appendChild(option);
    }
  }

  function resolveInitialSetId() {
    const requestedSetId = new URLSearchParams(window.location.search).get("set");
    if (requestedSetId && getSetMetaById(requestedSetId)) {
      return requestedSetId;
    }

    const persistedSetId = localStorage.getItem(SELECTED_SET_STORAGE_KEY);
    if (persistedSetId && getSetMetaById(persistedSetId)) {
      return persistedSetId;
    }

    return manifest.defaultSetId || manifest.sets.at(-1)?.id || manifest.sets[0].id;
  }

  async function switchSet(requestedSetId, options = {}) {
    const setMeta = getSetMetaById(requestedSetId) || manifest.sets[0];
    const requestToken = ++loadRequestToken;
    disableControls(true);
    hideHoverPreview();
    setSelector.value = setMeta.id;
    renderAppMessage(`Loading ${setMeta.name}…`);

    try {
      const runtime = await getRuntimeForSet(setMeta.id);
      if (requestToken !== loadRequestToken) {
        return;
      }

      currentSetMeta = runtime.meta;
      initializeRuntime(runtime);
      updatePageCopy();
      updateSelectedSetState(options.replaceHistory !== false);
      render();
      disableControls(false);
      if (options.showStatus) {
        setStatus(`Loaded ${currentSetMeta.name}.`, "success");
      }
    } catch (error) {
      disableControls(false);
      renderAppMessage(error instanceof Error ? error.message : "Failed to load set data.", true);
      setStatus(error instanceof Error ? error.message : "Failed to load set data.", "error");
    }
  }

  function disableControls(disabled) {
    resetButton.disabled = disabled;
    resetAllButton.disabled = disabled;
    exportButton.disabled = disabled;
    importButton.disabled = disabled;
    importFileInput.disabled = disabled;
    cuOnlyToggle.disabled = disabled;
    rsrlOnlyToggle.disabled = disabled;
    setSelector.disabled = disabled;
  }

  function updatePageCopy() {
    setEyebrow.textContent = `Lorcana Set ${currentSetMeta.number}`;
    pageTitle.textContent = `${currentSetMeta.name} Tier Views`;
    pageSubhead.textContent =
      `Drag cards from the untiered pool into A, B, C+, C, C-, D+, D, or F for ${currentSetMeta.name}. `
      + "Cost tabs and filter tabs share the same underlying placements, and costs 7 and up are grouped together.";
    document.title = `Lorcana Set ${currentSetMeta.number} Tier List · ${currentSetMeta.name}`;
  }

  function updateSelectedSetState(replaceHistory) {
    localStorage.setItem(SELECTED_SET_STORAGE_KEY, currentSetMeta.id);
    setSelector.value = currentSetMeta.id;
    const url = new URL(window.location.href);
    url.searchParams.set("set", currentSetMeta.id);
    if (replaceHistory) {
      window.history.replaceState({}, "", url);
    }
  }

  function getSetMetaById(setId) {
    return manifest.sets.find((candidate) => candidate.id === setId) || null;
  }

  function getSetIdByNumber(setNumber) {
    const numericValue = typeof setNumber === "number" ? setNumber : Number(setNumber);
    if (!Number.isInteger(numericValue)) {
      return null;
    }
    return manifest.sets.find((candidate) => candidate.number === numericValue)?.id || null;
  }

  function getLegacyDefaultSetId() {
    return getSetMetaById(LEGACY_DEFAULT_SET_ID)?.id || manifest.defaultSetId || manifest.sets.at(-1)?.id || manifest.sets[0].id;
  }

  function loadSetPayload(setMeta) {
    const existingPayload = window.LORCANA_TIER_SITE_SETS?.[setMeta.id];
    if (existingPayload) {
      return Promise.resolve(existingPayload);
    }

    if (setAssetPromises.has(setMeta.id)) {
      return setAssetPromises.get(setMeta.id);
    }

    const promise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = setMeta.asset;
      script.async = true;
      script.dataset.setId = setMeta.id;
      script.onload = () => {
        const payload = window.LORCANA_TIER_SITE_SETS?.[setMeta.id];
        if (payload) {
          resolve(payload);
          return;
        }
        setAssetPromises.delete(setMeta.id);
        reject(new Error(`Loaded ${setMeta.asset} but no set payload was registered.`));
      };
      script.onerror = () => {
        setAssetPromises.delete(setMeta.id);
        reject(new Error(`Failed to load ${setMeta.asset}.`));
      };
      document.body.appendChild(script);
    });

    setAssetPromises.set(setMeta.id, promise);
    return promise;
  }

  async function getRuntimeForSet(setId) {
    const setMeta = getSetMetaById(setId);
    if (!setMeta) {
      throw new Error(`Unknown set ${setId}.`);
    }
    const payload = await loadSetPayload(setMeta);
    return buildSetRuntime(payload, setMeta);
  }

  function buildSetRuntime(payload, fallbackMeta) {
    const meta = payload?.meta || fallbackMeta;
    const runtimeCards = Array.isArray(payload?.cards) ? payload.cards.slice() : [];
    const runtimeSubtypeViews = Array.isArray(payload?.subtypeViews) ? payload.subtypeViews.slice() : [];
    const runtimeCardsById = Object.fromEntries(runtimeCards.map((card) => [card.id, card]));
    const runtimeCardsByBucket = runtimeCards.reduce((acc, card) => {
      (acc[card.costBucket] ||= []).push(card);
      return acc;
    }, {});
    const runtimeCostBuckets = TAB_ORDER.filter((bucket) => runtimeCardsByBucket[bucket]?.length);
    const subtypeFilterViews = runtimeSubtypeViews.map((view) => ({
      ...view,
      predicate: (card) => card.subtypes.includes(view.subtype) || (card.mentionedSubtypes || []).includes(view.subtype),
    }));
    const filterViews = [...BUILTIN_FILTER_VIEWS, ...subtypeFilterViews];
    const viewDefs = [
      ...runtimeCostBuckets.map((bucket) => ({ key: `cost:${bucket}`, label: bucket, type: "cost", bucket })),
      ...filterViews.filter((view) => runtimeCards.some(view.predicate)),
    ];

    return {
      meta,
      cards: runtimeCards,
      generatedSubtypeViews: runtimeSubtypeViews,
      cardsById: runtimeCardsById,
      cardsByBucket: runtimeCardsByBucket,
      costBuckets: runtimeCostBuckets,
      filterViews,
      viewDefs,
    };
  }

  function initializeRuntime(runtime) {
    currentRuntime = runtime;
    cards = runtime.cards;
    generatedSubtypeViews = runtime.generatedSubtypeViews;
    cardsById = runtime.cardsById;
    cardsByBucket = runtime.cardsByBucket;
    costBuckets = runtime.costBuckets;
    FILTER_VIEWS = runtime.filterViews;
    VIEW_DEFS = runtime.viewDefs;

    const persisted = loadPersistedState(runtime.meta.id);
    activeViewKey = isValidViewKeyFor(runtime, persisted.activeViewKey) ? persisted.activeViewKey : runtime.viewDefs[0]?.key || "cost:1";
    state = normalizeStateFor(runtime, persisted.state);
    rarityFilterMode = "all";
    cuOnlyToggle.checked = false;
    rsrlOnlyToggle.checked = false;
  }

  function getStorageKeyFor(setId) {
    return `lorcana-tier-site-set${setId}-v${STORAGE_KEY_VERSION}`;
  }

  function getStorageKey() {
    return getStorageKeyFor(currentSetMeta.id);
  }

  function loadPersistedState(setId) {
    try {
      const raw = localStorage.getItem(getStorageKeyFor(setId));
      if (!raw) {
        return { state: null, activeViewKey: null };
      }

      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.state) {
        return {
          state: parsed.state,
          activeViewKey: typeof parsed.activeViewKey === "string" ? parsed.activeViewKey : null,
        };
      }

      return { state: parsed, activeViewKey: null };
    } catch {
      return { state: null, activeViewKey: null };
    }
  }

  function saveSetState(setId, nextActiveViewKey, nextState) {
    localStorage.setItem(
      getStorageKeyFor(setId),
      JSON.stringify({
        version: STORAGE_ENTRY_VERSION,
        setId,
        activeViewKey: nextActiveViewKey,
        state: nextState,
      })
    );
  }

  function saveState() {
    saveSetState(currentSetMeta.id, activeViewKey, state);
  }

  function resetAllTierPlacements() {
    disableControls(true);
    try {
      for (const setMeta of manifest.sets) {
        localStorage.removeItem(getStorageKeyFor(setMeta.id));
      }

      state = createDefaultState();
      saveState();
      render();
      setStatus("Reset tier placements for all sets.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to reset tier placements for all sets.", "error");
    } finally {
      disableControls(false);
    }
  }

  function createDefaultStateFor(runtime) {
    const nextState = {};
    for (const bucket of runtime.costBuckets) {
      nextState[bucket] = emptyBucketState();
      nextState[bucket].pool = runtime.cardsByBucket[bucket]
        .slice()
        .sort((a, b) => a.number - b.number)
        .map((card) => card.id);
    }
    return nextState;
  }

  function createDefaultState() {
    return createDefaultStateFor(currentRuntime);
  }

  function emptyBucketState() {
    return Object.fromEntries(ZONES.map((zone) => [zone, []]));
  }

  function normalizeStateFor(runtime, rawState) {
    const normalized = {};
    const defaultState = createDefaultStateFor(runtime);

    for (const bucket of runtime.costBuckets) {
      const validIds = new Set(runtime.cardsByBucket[bucket].map((card) => card.id));
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

      const missing = runtime.cardsByBucket[bucket]
        .map((card) => card.id)
        .filter((id) => !seen.has(id))
        .sort((left, right) => runtime.cardsById[left].number - runtime.cardsById[right].number);

      bucketState.pool.push(...missing);
      normalized[bucket] = bucketState;
    }

    return normalized;
  }

  function normalizeState(rawState) {
    return normalizeStateFor(currentRuntime, rawState);
  }

  async function exportStateToJson() {
    disableControls(true);
    try {
      const payload = {
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        selectedSetId: currentSetMeta.id,
        sets: {},
      };

      for (const setMeta of manifest.sets) {
        const runtime = await getRuntimeForSet(setMeta.id);
        const persisted = loadPersistedState(setMeta.id);
        const nextActiveViewKey = isValidViewKeyFor(runtime, persisted.activeViewKey) ? persisted.activeViewKey : runtime.viewDefs[0]?.key || "cost:1";
        payload.sets[setMeta.id] = {
          setId: setMeta.id,
          setNumber: runtime.meta.number,
          setName: runtime.meta.name,
          activeViewKey: nextActiveViewKey,
          state: normalizeStateFor(runtime, persisted.state),
        };
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = ALL_SETS_EXPORT_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus("Exported tier lists for all sets.", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to export tier list JSON.", "error");
    } finally {
      disableControls(false);
    }
  }

  async function handleImportFile(event) {
    const [file] = event.target.files || [];
    if (!file) {
      return;
    }

    disableControls(true);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      let restoredSetId = currentSetMeta.id;
      let successMessage = `Imported tier list from ${file.name}.`;

      if (isAllSetsExportPayload(payload)) {
        const importedSetIds = await importAllSetsPayload(payload);
        if (!importedSetIds.length) {
          throw new Error("File does not contain any recognized set tier data.");
        }

        restoredSetId = resolveImportedSelectedSetId(payload.selectedSetId, importedSetIds);
        successMessage = `Imported tier lists for ${importedSetIds.length} set${importedSetIds.length === 1 ? "" : "s"} from ${file.name}.`;
      } else if (isSingleSetExportPayload(payload)) {
        restoredSetId = await importSingleSetPayload(payload);
        successMessage = `Imported tier list into ${getSetMetaById(restoredSetId)?.name || `set ${restoredSetId}`} from ${file.name}.`;
      } else if (isPlainObject(payload)) {
        restoredSetId = await importSingleSetPayload({ state: payload });
        successMessage = `Imported legacy tier list into ${getSetMetaById(restoredSetId)?.name || `set ${restoredSetId}`} from ${file.name}.`;
      } else {
        throw new Error("File does not contain tier list state.");
      }

      await switchSet(restoredSetId, { replaceHistory: true, showStatus: false });
      setStatus(successMessage, "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import tier list JSON.", "error");
    } finally {
      importFileInput.value = "";
      disableControls(false);
    }
  }

  function isAllSetsExportPayload(payload) {
    return isPlainObject(payload) && isPlainObject(payload.sets);
  }

  function isSingleSetExportPayload(payload) {
    return isPlainObject(payload) && isPlainObject(payload.state) && !("sets" in payload);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  async function importAllSetsPayload(payload) {
    const importedSetIds = [];

    for (const [setId, entry] of Object.entries(payload.sets)) {
      if (!isPlainObject(entry) || !isPlainObject(entry.state)) {
        continue;
      }

      const setMeta = getSetMetaById(setId);
      if (!setMeta) {
        continue;
      }

      const runtime = await getRuntimeForSet(setId);
      const nextActiveViewKey = isValidViewKeyFor(runtime, entry.activeViewKey) ? entry.activeViewKey : runtime.viewDefs[0]?.key || "cost:1";
      const nextState = normalizeStateFor(runtime, entry.state);
      saveSetState(setId, nextActiveViewKey, nextState);
      importedSetIds.push(setId);
    }

    return importedSetIds;
  }

  async function importSingleSetPayload(payload) {
    const targetSetId = resolveSingleSetImportTarget(payload);
    const runtime = await getRuntimeForSet(targetSetId);
    const nextActiveViewKey = isValidViewKeyFor(runtime, payload.activeViewKey) ? payload.activeViewKey : runtime.viewDefs[0]?.key || "cost:1";
    const nextState = normalizeStateFor(runtime, payload.state);
    saveSetState(targetSetId, nextActiveViewKey, nextState);
    return targetSetId;
  }

  function resolveSingleSetImportTarget(payload) {
    if (typeof payload.setId === "string") {
      if (!getSetMetaById(payload.setId)) {
        throw new Error(`Import references unknown set ${payload.setId}.`);
      }
      return payload.setId;
    }

    if (payload.setNumber !== undefined) {
      const setId = getSetIdByNumber(payload.setNumber);
      if (!setId) {
        throw new Error(`Import references unknown set ${payload.setNumber}.`);
      }
      return setId;
    }

    return getLegacyDefaultSetId();
  }

  function resolveImportedSelectedSetId(selectedSetId, importedSetIds) {
    if (typeof selectedSetId === "string" && importedSetIds.includes(selectedSetId) && getSetMetaById(selectedSetId)) {
      return selectedSetId;
    }
    if (importedSetIds.includes(currentSetMeta.id)) {
      return currentSetMeta.id;
    }
    return importedSetIds[0];
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

  function render() {
    if (!currentSetMeta) {
      return;
    }
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
      button.append(getTabLabel(view));
      count.textContent = getTabCountLabel(view);
      button.appendChild(count);
      button.addEventListener("click", () => {
        activeViewKey = view.key;
        saveState();
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

  function renderAppMessage(message, isError = false) {
    const notice = document.createElement("section");
    notice.className = isError ? "app-message is-error" : "app-message";
    notice.textContent = message;
    appRoot.replaceChildren(notice);
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
      return `(${subtypeCount}/${mentionOnlyCount})`;
    }

    return `(${getViewCardCount(view)})`;
  }

  function getTabLabel(view) {
    if (view.type === "cost") {
      return `${view.label} cost`;
    }
    return view.label;
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

  function isValidViewKeyFor(runtime, viewKey) {
    return typeof viewKey === "string" && runtime.viewDefs.some((view) => view.key === viewKey);
  }
})();
