# Smart Expense Categorizer

A sleek React web app (Vite + Tailwind) that lets you upload credit card statements (CSV or PDF), categorize each transaction with multiple choice or drag‑and‑drop, learns your choices per merchant, and shows totals + analytics per statement.

## Features
- Upload **CSV/PDF** (CSV with headers: Date, Description/Merchant, Amount works best)
- **Interactive categorization** (buttons + drag & drop) with **Back/Undo**
- **Auto-learning rules** per merchant; auto-applied on future uploads
- **Statement detection**: parses dates and creates a labeled period for each upload; choose via dropdown
- **Analytics**: category breakdown pie, daily stacked bars, and per-category totals
- **Export**: download categorized CSV

## Categories
- utilities, auto, meal, travel, insurance, office, purchases, shipping (+ uncategorized)

## Run Locally
```bash
# In this folder:
npm install
npm run dev
# Open the URL from the terminal (usually http://localhost:5173)
```

## Build & Deploy
```bash
npm run build
# Deploy the contents of dist/ to Netlify, Vercel, GitHub Pages, Cloudflare Pages, etc.
```

### Notes
- PDF parsing uses heuristics and may not capture every bank format. CSV is recommended for accuracy.
- All data is stored **locally in your browser** (LocalStorage). No backend required.
