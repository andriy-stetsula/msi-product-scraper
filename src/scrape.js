const { chromium } = require('playwright');
const fs = require('fs');

const URL = 'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';

const parsePrice = (text) => {
  if (!text) return null;
  const num = parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(num) ? num : null;
};

async function extractProduct(page) {
  return page.evaluate(() => {
    const clean = (s) => (s ? s.replace(/\s+/g, ' ').trim() : null) || null;
    const root = document.querySelector('.product-detail');
    const titleEl = root.querySelector('h2.title');
    const column = titleEl.closest('.col-md-6') || root;
    const wrapper = root.querySelector('#prices-wrapper');

    const category = [...document.querySelectorAll('li.breadcrumb-item')]
      .map((li) => {
        const a = li.querySelector('a');
        return { name: clean(li.textContent), url: a ? a.href : null };
      })
      .filter((c) => c.name && c.name.toLowerCase() !== 'home' && c.url);

    const description = clean(
      [...column.querySelectorAll('p, div')].find(
        (el) =>
          el !== titleEl &&
          !el.querySelector('style, script') &&
          el.textContent.trim().length > 80 &&
          el.textContent.includes(titleEl.textContent.trim()) &&
          !el.querySelector('div, button, input')
      )?.textContent
    );

    const images = [
      ...new Set(
        [...document.querySelectorAll('img')]
          .map((i) => i.currentSrc || i.src || i.dataset.src)
          .filter((s) => s && /Pd_page.*1024x1024/.test(s))
      ),
    ];

    const specs = [];
    const seen = new Set();
    root.querySelectorAll('tr').forEach((tr) => {
      const cells = tr.querySelectorAll('th, td');
      if (cells.length < 2) return;
      const name = clean(cells[0].textContent);
      const value = clean(cells[1].textContent);
      if (!name || seen.has(name)) return;
      seen.add(name);
      specs.push({ name, value });
    });

    const buttonTexts = [...column.querySelectorAll('button, input[type="button"]')].map((b) =>
      clean(b.textContent || b.value || '')
    );

    const ratingText = clean(document.querySelector('#description-list-average-rating')?.textContent);
    const ratingMatch = ratingText?.match(/([\d.]+)\s*\((\d+)\)/);

    return {
      title: clean(titleEl.textContent),
      documentTitle: document.title,
      itemId: root.querySelector('input[name="product_id"]')?.value || null,
      priceNew: wrapper?.querySelector('.prices-new, .price-new')?.textContent || null,
      priceOld: wrapper?.querySelector('.price-old, .prices-old')?.textContent || null,
      category,
      description,
      images,
      specs,
      buttonTexts,
      rating: ratingMatch ? ratingMatch[1] : null,
      reviews: ratingMatch ? ratingMatch[2] : null,
    };
  });
}

function getAvailability(buttonTexts) {
  const text = buttonTexts.join(' | ');
  if (/pre-?order/i.test(text)) return 'pre_order';
  if (/add to cart/i.test(text)) return 'in_stock';
  if (/notify me/i.test(text)) return 'out_of_stock';
  return null;
}

function normalize(raw) {
  const priceNew = parsePrice(raw.priceNew);
  const priceOld = parsePrice(raw.priceOld);
  const onSale = priceOld !== null && priceNew !== null && priceOld > priceNew;
  const mpn = raw.specs.find((s) => /manufacturer number/i.test(s.name))?.value ?? null;

  return {
    url: URL,
    item_id: raw.itemId,
    title: raw.title,
    brand: raw.documentTitle?.split(' ')[0] ?? null,
    product_category: raw.category.length ? raw.category.map((c) => c.name).join(' > ') : null,
    category_tree: raw.category,
    description: raw.description,
    price: onSale ? priceOld : priceNew,
    sale_price: onSale ? priceNew : null,
    availability: getAvailability(raw.buttonTexts),
    image_url: raw.images[0] ?? null,
    additional_image_urls: raw.images.slice(1),
    specs: raw.specs,
    star_rating: raw.rating ? parseFloat(raw.rating) : null,
    review_count: raw.reviews ? parseInt(raw.reviews, 10) : null,
    gtin: null,
    mpn,
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });

  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1366, height: 768 },
    });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('.product-detail #prices-new', { timeout: 30000 });
    await page.waitForTimeout(2000);

    const product = normalize(await extractProduct(page));

    fs.mkdirSync('output', { recursive: true });
    fs.writeFileSync('output/product.json', JSON.stringify(product, null, 2));
    console.log('Saved output/product.json');
  } catch (err) {
    console.error('Scrape failed:', err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();