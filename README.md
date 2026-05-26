# Wudinna Aero Rainfall App

Static GitHub Pages app for Wudinna Aero BOM station 018083.

The chart uses:

- historical monthly rainfall embedded in `app.js`
- rainfall years running from 1 November to 31 October
- all historical years plotted point-to-point in grey
- top 3 highest rainfall years highlighted in green
- bottom 3 lowest rainfall years highlighted in red
- median cumulative monthly line
- current rainfall year ending October 2026 plotted daily from 1 November 2025

## Files

- `index.html` — app shell
- `styles.css` — responsive iPhone-friendly styling
- `app.js` — chart logic and embedded historical monthly data
- `data/current-year.json` — current daily rainfall data used by the app
- `scripts/update-current-year.js` — fetches BOM daily ZIPs and refreshes `data/current-year.json`
- `.github/workflows/update-rainfall.yml` — GitHub Action for automated refresh

## Setup

1. Create a new GitHub repository.
2. Upload all files and folders from this package to the repo root.
3. In GitHub, go to Settings → Pages.
4. Set GitHub Pages to deploy from the `main` branch root, or use your preferred Pages setup.
5. Go to Actions and run `Update Wudinna rainfall data` manually once.
6. The Action will then refresh the daily rainfall JSON automatically each day.

## iPhone use

Open the GitHub Pages URL in Safari and choose Share → Add to Home Screen.

In landscape orientation, the app hides summary text and lets the chart fill the screen.
