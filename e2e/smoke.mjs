// Browser test in installed Microsoft Edge: 3D model, price, language, shared link and the quote request.
// Also saves screenshots to docs/. Run after `npm run build`.
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { startServer } from '../scripts/serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
await mkdir(docs, { recursive: true });

const server = await startServer({ root: join(root, 'dist') });
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const problems = [];
const text = async (locator) => (await locator.textContent()).replace(/\s+/g, ' ').trim();
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

function watch(page) {
  page.on('pageerror', (error) => problems.push(`błąd JavaScript: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`konsola: ${message.text()}`);
  });
  page.on('requestfailed', (request) => problems.push(`nie wczytano: ${request.url()}`));
}

async function noSideScroll(page, label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `${label}: strona przewija się w bok o ${overflow}px`);
}

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'pl-PL' });
  const page = await desktop.newPage();
  watch(page);

  await page.goto(base);
  await page.locator('#widok.is-ready').waitFor();
  check(await page.locator('#brak-3d').isHidden(), '3D: model się nie wczytał');
  check((await text(page.locator('#cena'))) === '14 700 zł', 'cena: zła cena domyślnej pergoli');
  await noSideScroll(page, 'konfigurator');
  await settle(page);
  await page.screenshot({ path: join(docs, 'konfigurator-start.png') });

  // Size, lamella roof, wood colour, screens and LED.
  await page.locator('#szerokosc').fill('6');
  check((await text(page.locator('#cena'))) === '21 300 zł', 'cena: szerokość 6 m');
  check(page.url().includes('s=6'), 'link: szerokość nie trafiła do adresu');
  check(await page.locator('#kat-pole').isHidden(), 'kąt lamel widać przy poliwęglanie');
  await page.locator('label.card-option', { hasText: 'Lamele' }).click();
  await page.locator('#kat').fill('60');
  await page.locator('label.swatch', { hasText: 'Drewnopodobny' }).click();
  await page.locator('label.chip', { hasText: 'Przód' }).click();
  await page.locator('label.chip', { hasText: 'Lewa strona' }).click();
  await page.locator('#opuszczenie').fill('80');
  await page.getByRole('switch', { name: /Oświetlenie LED/ }).check();
  check((await text(page.locator('#cena'))) === '57 850 zł', 'cena: lamele, drewno, rolety i LED');
  await page.locator('.breakdown summary').click();
  check(await page.locator('#rozbicie li').count() === 6, 'rozbicie ceny powinno mieć 6 pozycji');
  await settle(page);
  await page.screenshot({ path: join(docs, 'konfigurator.png') });

  // Evening: lit window and LED strips. Screens are raised a bit so the light under the roof shows.
  await page.locator('#opuszczenie').fill('30');
  await page.getByRole('button', { name: 'Wieczór' }).click();
  check(await page.locator('#wieczor').getAttribute('aria-pressed') === 'true', 'wieczór: przycisk nie jest wciśnięty');
  await settle(page);
  await page.locator('#widok').screenshot({ path: join(docs, 'konfigurator-wieczor.png') });
  await page.getByRole('button', { name: 'Wieczór' }).click();
  await page.getByRole('button', { name: 'Przód' }).first().click();
  await settle(page);
  await page.locator('#widok').screenshot({ path: join(docs, 'konfigurator-przod.png') });

  // German version with prices in euro.
  await page.getByRole('button', { name: 'DE' }).click();
  check((await text(page.locator('h1'))) === 'Gestalten Sie Ihre Pergola in 3D', 'DE: nagłówek nie jest po niemiecku');
  check((await text(page.locator('#cena'))) === '13.720 €', 'DE: zła cena w euro');
  check(page.url().includes('j=de'), 'DE: język nie trafił do adresu');
  await page.getByRole('button', { name: 'PL' }).click();

  // Quote request: snapshot, validation, thank-you screen and the printable summary.
  await page.getByRole('button', { name: 'Wyślij do wyceny' }).click();
  await page.locator('#zapytanie[open]').waitFor();
  check((await page.locator('#podglad').getAttribute('src'))?.startsWith('data:image/jpeg'), 'zapytanie: brak podglądu modelu');
  check(await page.locator('#podsumowanie li').count() === 8, 'zapytanie: podsumowanie powinno mieć 8 pozycji');
  await page.getByRole('button', { name: 'Wyślij zapytanie' }).click();
  check(await page.locator('#formularz [aria-invalid="true"]').count() === 3, 'zapytanie: pusty formularz powinien pokazać 3 błędy');
  await page.getByLabel('Imię i nazwisko').fill('Jan Kowalski');
  await page.getByLabel('E-mail').fill('jan@example.com');
  await page.getByLabel(/Zgadzam się na kontakt/).check();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(docs, 'zapytanie.png') });
  await page.getByRole('button', { name: 'Wyślij zapytanie' }).click();
  await page.getByRole('heading', { name: 'Dziękujemy, Jan!' }).waitFor();
  await page.evaluate(() => { window.print = () => { window.drukowano = true; }; });
  await page.getByRole('button', { name: 'Pobierz podsumowanie (PDF)' }).click();
  check(await page.evaluate(() => window.drukowano === true), 'PDF: nie wywołano drukowania');
  check((await page.locator('#wydruk img').getAttribute('src'))?.startsWith('data:image/jpeg'), 'PDF: brak zdjęcia modelu w podsumowaniu');
  check((await text(page.locator('#wydruk h1'))).startsWith('Konfiguracja pergoli'), 'PDF: brak tytułu podsumowania');
  // The real print layout, saved the way a visitor would save it from the print dialog.
  await page.pdf({ path: join(docs, 'podsumowanie.pdf'), format: 'A4', printBackground: true });

  // A shared link restores the configuration and the language.
  await page.goto(`${base}?s=5&g=4&d=szklo&c=9016&m=wolnostojaca&l=1&j=de`);
  await page.locator('#widok.is-ready').waitFor();
  check(await page.locator('input[name="roof"][value="szklo"]').isChecked(), 'link: dach ze szkła nie wrócił');
  check(await page.locator('input[name="mount"][value="wolnostojaca"]').isChecked(), 'link: montaż nie wrócił');
  check((await text(page.locator('#cena'))).endsWith('€'), 'link: język niemiecki nie wrócił');
  await desktop.close();

  // Phone width.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pl-PL', isMobile: true, hasTouch: true });
  const mobile = await phone.newPage();
  watch(mobile);
  await mobile.goto(`${base}?d=lamele&c=7016&z=front&o=50&l=1`);
  await mobile.locator('#widok.is-ready').waitFor();
  await noSideScroll(mobile, 'telefon');
  await settle(mobile);
  await mobile.screenshot({ path: join(docs, 'telefon.png') });
  await mobile.locator('.price-card').scrollIntoViewIfNeeded();
  await noSideScroll(mobile, 'telefon: cena');
  await phone.close();
} catch (error) {
  problems.push(`test przerwany: ${error.message.split('\n').slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(`Problemy (${problems.length}):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('Test w przeglądarce przeszedł. Zrzuty ekranu są w docs/.');
