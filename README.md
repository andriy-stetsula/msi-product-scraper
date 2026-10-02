# MSI Product Scraper

Scrapes one MSI US store product page with Playwright.

## Run

npm install
npx playwright install chromium
npm run scrape

Result: output/product.json

## Notes

- Uses installed Google Chrome (`channel: 'chrome'`).
- The site blocks Playwright's bundled Chromium in headless mode (Access Denied).
