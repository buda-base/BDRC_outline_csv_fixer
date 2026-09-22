# BDRC Outline Issue Fixer

Static web tool for librarians to review and fix BDRC outline span issues.
Upload `outline.csv` and `issue.json`, correct spans and part types in the
browser, then download the updated CSV. Nothing is saved on a server.

## Use (hosted)

Open the GitHub Pages site for this repository, then:

1. Upload `outline.csv` and `issue.json`
2. Fix spans / part types in the workspace (live issue re-check)
3. Click **Export CSV** to download the corrected file

## Local preview

Serve the `docs/` folder with any static file server:

```bash
cd docs
python3 -m http.server 8000
```

Open http://127.0.0.1:8000

## GitHub Pages

The site is the contents of [`docs/`](docs/). A workflow deploys it on push to
`main`/`master`.

To enable Pages in the repo settings:

1. **Settings → Pages → Build and deployment**
2. Source: **GitHub Actions**

Or use **Deploy from a branch** with branch `main` / `master` and folder `/docs`.

## How it works

- **Upload page** — parses CSV and JSON in the browser and stores them in
  `sessionStorage`
- **Workspace** — same three-panel layout (issues / BDRC embed / editable
  segments). Segments are listed in CSV row order (no `.trig` files)
- **Export** — writes a full CSV with updated `img start`, `img end`,
  `vol start`, `vol end`, and `part type`, preserving other columns

### Issue re-check

Edits re-evaluate each issue's `skip_detail`:

- `range*` issues (`A.start_page (N) < B.end_page (M)`): resolved when
  `A.img start >= B.img end`, or when A/B are in different volumes, or when
  either is re-typed to a container (`S` / `V`)
- `missing_end*` issues (`segment(s) A, B`): resolved when every listed
  segment has an `img end` (and `img end >= img start`)
- Anything that cannot be evaluated (segment missing from the CSV, blank
  `img start`) is reported as *Unverifiable*


## Credits

This repo is developed by Dharmaduta based on specifications from the Buddhist Digital Resource Center for the project The BDRC Etext Corpus, funded by the Khyentse Foundation.