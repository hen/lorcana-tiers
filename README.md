# lorcana-tiers

Static Lorcana tier-list site sources live under `docs/tiersite/`.

The site now supports all generated expansion sets through a set picker. Its runtime data is generated into:

- `docs/tiersite/data/manifest.js`
- `docs/tiersite/data/set.<N>.js`

Tier placement persistence stays per set in browser storage, but JSON transfer is now cross-set:

- **Export JSON** writes one file containing all supported sets.
- **Import JSON** accepts that all-set format.
- **Reset tier** clears only the active set.
- **Reset all tiers** clears saved placements for every supported set.
- Older single-set exports still import correctly.
- Raw legacy state with no set metadata is assumed to belong to **set 12**.

## Regenerating site data

From the repository root, point the generator at one or more raw `setdata.N.json` files or at a directory that contains them:

```bash
python3 generate_cards_js.py ..
```

That command discovers numeric `setdata.N.json` files, skips non-expansion/non-numeric files such as quest data, and rebuilds the multi-set assets used by the site.

You can also regenerate a single set asset:

```bash
python3 generate_cards_js.py /path/to/setdata.13.json
```

## Thumbnail behavior

When generating site data, the converter prefers local thumbnails in:

```text
docs/images/set.<N>.thumbs/<card-id>.jpg
```

If a local thumbnail is missing, it falls back to the remote thumbnail URL embedded in the raw setdata JSON. That means a new set can be added immediately with just its `setdata.N.json` file, and local thumbnails remain optional.

To pre-download local thumbnails for a set:

```bash
./download_filtered_thumbs.sh ../setdata.13.json
```

## Future sets

To add a future set:

1. Drop in `setdata.<N>.json`.
2. Optionally run `./download_filtered_thumbs.sh` for that file.
3. Run `python3 generate_cards_js.py` against the file or containing directory.

No GitHub commit or publish step is required for the conversion itself.
