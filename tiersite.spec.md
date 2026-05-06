# Lorcana Tier Site Rebuild Spec

This file captures the final intended behavior, data conventions, and implementation decisions for the static tier-list site in `tiersite/`. It should be sufficient to rebuild the site from scratch without replaying the prompt history.

## Goal

Build a static website for ranking Lorcana cards from a single set into these internal tiers:

- `A`
- `B`
- `C+`
- `C`
- `C-`
- `D+`
- `D`
- `F`

These should render as six visible rows:

1. `A`
2. `B`
3. split row with `C+` and `C`
4. split row with `C-` and `D+`
5. `D`
6. `F`

The site is intended for local use and should work as plain HTML/CSS/JS without a build step.

## Data Sources

### Set data

Use a Lorcana set JSON file such as:

- `setdata.12.json`

The JSON may be either:

1. a top-level array of card objects, or
2. an object containing a `cards` array.

### Thumbnail images

Use local thumbnails stored under:

- `images/set.<SET_ID>.thumbs/`

Important final decision:

- thumbnail filenames must use the card JSON **`id`** field, not the set `number`
- example: `images/set.12.thumbs/2718.jpg`

This avoids collisions when multiple cards share the same `number`.

## Included Card Subset

The site does **not** show every card in the set.

Only include cards whose `rarity` is one of:

- `Common`
- `Uncommon`
- `Rare`
- `Super Rare`
- `Legendary`

Skip:

- `Enchanted`
- `Special Edition`
- any other rarity outside the above list

Also skip any card whose local thumbnail file is missing.

## Generated Site Data

The runtime site consumes a generated JS file:

- `tiersite/cards.js`

This file assigns a global:

```js
window.LORCANA_SET12_CARDS = [...]
```

Each card entry should contain:

```json
{
  "id": "2718",
  "number": 3,
  "name": "Woody - Waiting for a Friend",
  "type": "Character",
  "subtypes": ["Storyborn", "Hero", "Toy"],
  "rarity": "Common",
  "story": "Toy Story",
  "cost": 1,
  "costBucket": "1",
  "inkwell": true,
  "parDelta": 0,
  "thumbnail": "../images/set.12.thumbs/2718.jpg"
}
```

### Basic value / par delta

For cards with numeric `strength`, `willpower`, and `lore`, compute:

```text
basicValue = strength + willpower + (2 * lore - 1)
```

Compare that against the cost par table:

```text
1 -> 5
2 -> 7
3 -> 9
4 -> 11
5 -> 14
6 -> 16
7 -> 19
```

Final decision:

- any cost `7` or greater uses the `7` baseline (`19`)
- store the difference as `parDelta`
- for cards without the needed stats (for example `Action`, `Item`, or `Location`), set `parDelta` to `null`
- explain on the page that the bottom-right number on a character card is its delta from that cost's vanilla stat line

### Sorting rule for `cards.js`

Final decision:

- sort generated entries by `number`
- use `id` as the tie-breaker

Do **not** preserve original setdata file order.

### Cost buckets

Underlying placement state is organized by cost:

- `1`
- `2`
- `3`
- `4`
- `5`
- `6`
- `7+`

Cards with cost `7` or greater go into the `7+` bucket.

### Filter-view metadata

The generated card data must also preserve enough metadata to build filter views over the same state:

- `type`
- `subtypes`
- `inkwell`

## Support Scripts

### Thumbnail downloader

`download_filtered_thumbs.sh`

Purpose:

- take a `setdata.N.json` file
- filter to the allowed rarities
- download thumbnails into `images/set.N.thumbs/`
- save each file as `<json id>.jpg`
- skip download if the file already exists

Expected behavior:

```bash
./download_filtered_thumbs.sh setdata.12.json
```

### cards.js generator

`generate_cards_js.py`

Purpose:

- take a `setdata.N.json` file
- read local thumbnails from `images/set.N.thumbs/`
- generate `tiersite/cards.js`
- skip any filtered card whose local thumbnail is missing
- sort output by `number`, then `id`

Typical use:

```bash
python3 generate_cards_js.py setdata.12.json
```

Optional explicit output:

```bash
python3 generate_cards_js.py setdata.12.json tiersite/cards.js
```

## Site File Layout

The site is plain static files:

- `tiersite/index.html`
- `tiersite/styles.css`
- `tiersite/app.js`
- `tiersite/cards.js`

No framework, bundler, or package manager is required.

## UI Layout

### Header

Show:

- title for the set
- short descriptive subtitle
- controls:
  - `Export JSON`
  - `Import JSON`
  - `Reset all tiers`

Also include a short status/message area for import/export/reset feedback.

The page should also include a short explanatory note near the board clarifying that the bottom-right numbers on character cards show how far the card is above or below that cost's vanilla stat line.

### Display-only rarity filters

The tab area should include both `C/U Only` and `R/SR/L Only` checkboxes, both **off by default**.

When `C/U Only` is checked:

- show only `Common` and `Uncommon` cards
- hide `Rare`, `Super Rare`, and `Legendary` cards from both the tier rows and the untiered pool
- do **not** delete or rewrite the underlying placements for hidden cards
- toggling the checkbox back off should reveal those cards in their prior tier/pool locations

When `R/SR/L Only` is checked:

- show only `Rare`, `Super Rare`, and `Legendary` cards
- hide `Common` and `Uncommon` cards from both the tier rows and the untiered pool
- do **not** delete or rewrite the underlying placements for hidden cards
- toggling the checkbox back off should reveal those cards in their prior tier/pool locations

Final behavior choice:

- these are render-layer filters, not separate saved states
- only one rarity-only checkbox should be active at a time
- enabling one should clear the other

### Tabs

There should be tabs for both cost views and filtered views.

Cost-view tabs:

- `1`
- `2`
- `3`
- `4`
- `5`
- `6`
- `7+`

Additional filter-view tabs:

- `Items`
- `Songs`
- `Actions`
- `Locations`
- `Uninkable`

Rules:

- render cost-view tabs on the first line
- start the filter-view tabs on a new line after `7+`
- place the rarity filter checkboxes on the right side of the two tab rows
- each tab label should include the number of cards in that view
- `Songs` means `type == "Action"` and `subtypes` contains `"Song"`
- `Actions` means `type == "Action"` and not a song
- `Uninkable` means `inkwell == false`
- filter tabs are **views over the same underlying cost-bucket state**, not a separate second state store
- dragging a card in a filter tab must update the same placement that appears in its cost tab
- the right-side untiered pool must also be filtered to the active view

### Main board layout

The main interactive area is two columns:

1. **Left:** the six tier rows
2. **Right:** the untiered pool

#### Left side: tier rows

There are six visible rows.

Visible row order:

1. `A`
2. `B`
3. split row with `C+` and `C`
4. split row with `C-` and `D+`
5. `D`
6. `F`

Internal tier keys are:

- `A`
- `B`
- `C+`
- `C`
- `C-`
- `D+`
- `D`
- `F`

Each row contains:

1. a colored tier badge on the left
2. a card lane on the right

For the two mixed middle rows:

- keep them on one visual row each
- split each row into two independent side-by-side lanes
- `C+` and `C` share one row
- `C-` and `D+` share one row
- each sublane is a separate drag-and-drop target

Important final decision:

- remove the earlier row shell that displayed tier title and card count
- keep tier rows visually compact
- rows should stay at one thumbnail high until they run out of horizontal room
- when a tier lane fills up, it should wrap onto a second visual line instead of showing a scrollbar
- the row may grow taller to accommodate wrapped cards

The six rows should **not** stretch taller just because the untiered pool has many cards. Row growth should come from wrapped cards inside that row, not from the pool column.

#### Right side: untiered pool

The untiered pool is a **sidebar**, not a bottom row.

Final layout requirements:

- positioned to the right of the tier rows
- exactly **3 card columns wide**
- height should match the rendered height of the six tier rows
- if more cards exist than fit, the pool gets its own **vertical scrollbar**

The scrollbar belongs inside the pool column, not on the page as a whole.

### Mobile / narrow screens

Below a narrow breakpoint, collapsing back to one column is acceptable:

- board becomes stacked vertically
- the height matching behavior can be disabled on narrow screens

## Drag and Drop Behavior

The site must support HTML drag-and-drop using local state only.

### Requirements

- cards can be dragged from the untiered pool into any tier
- cards can be dragged from any tier back to the untiered pool
- cards can be reordered within the same lane
- cards can be moved between different tier rows

### Reordering logic

Use insertion based on pointer position relative to the midpoint of existing cards in the target lane.

### Empty lane hints

Final behavior:

- the untiered pool may show its empty helper text when empty
- empty tier lanes may show `Drop cards here.` only while the untiered pool still contains cards for that tab
- once the untiered pool is empty, remove the `Drop cards here.` hint from empty tier lanes

### State synchronization

Track state per cost bucket:

```js
{
  "1": { A: [], B: [], "C+": [], C: [], "C-": [], "D+": [], D: [], F: [], pool: [] },
  "2": { ... }
}
```

Every card ID must appear exactly once within its own bucket after normalization.

On load/import/reset:

- normalize state against the current card set
- discard invalid IDs
- dedupe repeated IDs
- append any missing valid IDs back into the pool, sorted by card number

## Hover Preview Behavior

### Final behavior

When the user hovers a card **without dragging**:

- show a magnified floating preview of the full card
- render the preview in a fixed overlay attached to `document.body`
- do **not** scale the image inside the row itself

Reason:

- inline scaling caused the card to be clipped inside the row
- a floating overlay ensures the entire card is visible

### Preview size

Final decision:

- preview size is **4×** the base thumbnail size for normal cards

Base thumbnail size:

- `80 x 112`

Normal preview size:

- `320 x 448`

### Location card rotation

Special final decision for `Location` cards:

- if `type === "Location"`, rotate the magnified popup **90 degrees**
- keep the popup as a floating overlay
- use the rotated bounds when calculating viewport fit

Effective rotated popup footprint:

- `448 x 320`

Implementation intent:

- normal cards use a portrait preview
- Location cards use the same underlying image but displayed rotated in the popup
- the preview logic must know whether the popup is rotated so it can keep the whole card onscreen

### Preview positioning

- position near the cursor
- keep it inside the viewport bounds
- if there is no room on the right, flip it to the left side of the cursor

### Drag interaction

As soon as dragging starts:

- hide the hover preview
- disable hover magnification while dragging

## Persistence

### Local browser persistence

Persist the current tier state in `localStorage`.

Current storage key convention:

- `lorcana-tier-site-set12-v4`

The storage key is versioned so incompatible tier-schema changes can invalidate older saved layouts.

### Export / import

Users must be able to save/load tier lists outside browser storage.

#### Export

Export current state to a JSON file containing:

```json
{
  "version": 1,
  "exportedAt": "ISO timestamp",
  "storageKey": "lorcana-tier-site-set12-v4",
  "activeViewKey": "cost:3",
  "state": { ... }
}
```

The exported file should be downloadable from the browser.

#### Import

Allow selecting a JSON file from disk.

Importer should accept either:

1. the full exported object with a `state` field, or
2. a raw state object

After import:

- normalize the imported state
- restore `activeViewKey` if valid
- save to localStorage
- re-render the UI

Show success/error feedback in the status message area.

## Styling Decisions

These are the important visual choices, not exact required hex values:

- dark theme
- glassy/dim panel backgrounds
- pastel tier badges with this semantic mapping:
  - `A` -> green
  - `B` -> cyan
  - `C+` and `C` -> yellow
  - `C-` and `D+` -> deeper yellow
  - `D` -> orange
  - `F` -> red
- rounded cards and panels
- compact spacing for rows
- tabs with active/inactive states
- pool sidebar visually distinct but aligned with the board

Exact colors can differ if rebuilt, but the information hierarchy should remain similar.

## Known Implementation Decisions That Matter

1. **Use card JSON `id` for identity**
   - internal drag/drop state uses `id`
   - exported/imported state uses `id`
   - thumbnails are keyed by `id`

2. **Do not use `number` as the internal ID**
   - duplicate card numbers caused collisions and hidden cards

3. **Still display `number` on the card**
   - superseded by final badge behavior below

4. **Card badge shows par delta, not set number**
   - bottom-right badge shows the difference from cost par
   - examples: `+1`, `-1`, `0`
   - cards with `parDelta = null` show no badge

5. **Basic value formula**
   - `strength + willpower + (2 * lore - 1)`
   - compare against the cost par table above

6. **Generate `cards.js` from local thumbnails**
   - only cards with existing local thumbnails should be included

7. **Sort generated cards by `number`**
   - not by original setdata order

8. **Split mixed C rows under the hood**
   - use `A`, `B`, `C+`, `C`, `C-`, `D+`, `D`, `F`
   - render `C+` and `C` on one shared visual row
   - render `C-` and `D+` on one shared visual row

9. **Pool is a sidebar**
   - 3 columns wide
   - same height as tier board
   - internal scroll for overflow

10. **Tier rows stay compact**
   - do not stretch vertically to match pool overflow

11. **Hover preview must be an overlay**
   - not an inline scaled thumbnail

## Rebuild Checklist

If rebuilding from scratch, the resulting system should satisfy all of these:

1. Build or update local thumbnails with `download_filtered_thumbs.sh`.
2. Generate `tiersite/cards.js` from `setdata.N.json` with `generate_cards_js.py`.
3. Create a static site with:
    - cost tabs
    - filter tabs for items, songs, non-song actions, locations, and uninkable cards
    - six tier rows
    - split side-by-side lanes for `C+`/`C`
    - split side-by-side lanes for `C-`/`D+`
    - right-side untiered sidebar
   - drag/drop between all lanes
   - localStorage persistence
   - JSON export/import
   - hover overlay preview
4. Ensure:
    - filtered rarities only
    - `id`-based card identity
    - `id`-based thumbnail filenames
    - cards sorted by `number`
    - generated card data includes `subtypes` and `inkwell`
    - filter views mutate the same placements as the cost views
    - pool scrollbar appears when needed

## Example Regeneration Flow

For set 12, the expected workflow is:

```bash
./download_filtered_thumbs.sh setdata.12.json
python3 generate_cards_js.py setdata.12.json
```

Then open:

```text
tiersite/index.html
```

in a browser.
