(() => {
  const COMMON_UNCOMMON = new Set(["Common", "Uncommon"]);
  const searchInput = document.getElementById("search");
  const rareToggle = document.getElementById("rare-toggle");
  const setFilter = document.getElementById("set-filter");
  const cardNames = document.getElementById("card-names");
  const cardsRoot = document.getElementById("cards");
  const resultsSummary = document.getElementById("results-summary");
  let cards = [];

  function primaryRarity(card) {
    return card.Rarity.split(",", 1)[0];
  }

  function visibleCards() {
    const search = searchInput.value.trim().toLocaleLowerCase();
    const showRare = rareToggle.checked;
    const selectedSet = setFilter.value;

    return cards.filter((card) => {
      const matchesSearch = !search || card.Name.toLocaleLowerCase().includes(search);
      const isCommonOrUncommon = COMMON_UNCOMMON.has(primaryRarity(card));
      const matchesSet = !selectedSet || card["Set Number"] === selectedSet;
      return matchesSearch && matchesSet && (showRare ? !isCommonOrUncommon : isCommonOrUncommon);
    });
  }

  function render() {
    const visible = visibleCards();
    const category = rareToggle.checked ? "rare cards" : "common and uncommon cards";
    resultsSummary.textContent = `${visible.length} ${category} need ${searchInput.value.trim() ? "matching your search" : "to complete playsets"}.`;
    cardsRoot.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No cards match these filters.";
      cardsRoot.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const card of visible) {
      const article = document.createElement("article");
      article.className = "card";

      const image = document.createElement("img");
      image.className = "card-image";
      image.src = card.thumbnail;
      image.alt = card.Name;
      image.loading = "lazy";
      article.append(image);

      const count = document.createElement("span");
      count.className = "need-count";
      count.textContent = card.Count;
      count.setAttribute("aria-label", `Need ${card.Count} more copies`);
      article.append(count);

      const details = document.createElement("div");
      details.className = "card-details";
      const name = document.createElement("h2");
      name.className = "card-name";
      name.textContent = card.Name;
      const meta = document.createElement("p");
      meta.className = "card-meta";
      meta.textContent = `${card.Rarity} · Set ${Number(card["Set Number"])} · Need ${card.Count}`;
      details.append(name, meta);
      article.append(details);
      fragment.append(article);
    }
    cardsRoot.append(fragment);
  }

  async function loadCards() {
    try {
      const response = await fetch("cards.json");
      if (!response.ok) {
        throw new Error(`Unable to load cards (${response.status}).`);
      }
      cards = await response.json();
      for (const name of [...new Set(cards.map((card) => card.Name))].sort()) {
        const option = document.createElement("option");
        option.value = name;
        cardNames.append(option);
      }
      render();
    } catch (error) {
      resultsSummary.textContent = error instanceof Error ? error.message : "Unable to load cards.";
    }
  }

  searchInput.addEventListener("input", render);
  rareToggle.addEventListener("change", render);
  setFilter.addEventListener("change", render);
  void loadCards();
})();
