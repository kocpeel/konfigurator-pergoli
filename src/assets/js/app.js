// Page logic: form ⇄ configuration ⇄ 3D model, price, language, shareable link and the quote request.
import { fromQuery, normalize, toQuery } from './config.js';
import { validateQuote } from './form-core.js';
import { escapeHtml } from './html.js';
import { CURRENCY, LANGS, LOCALE, formatLength, formatMoney, t } from './i18n.js';
import { quote } from './pricing.js';

const form = document.getElementById('konfiguracja');
const canvas = document.getElementById('scena');
const dialog = document.getElementById('zapytanie');
const quoteForm = document.getElementById('formularz');
const FIELDS = ['name', 'email', 'phone', 'consent'];

const params = new URLSearchParams(location.search);
let lang = LANGS.includes(params.get('j')) ? params.get('j') : 'pl';
let config = fromQuery(location.search);
let viewer = null;
let snapshot = '';

const tr = (key, values) => t(lang, key, values);
const number = (value) => new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 2 }).format(value);

function writeForm(values) {
  for (const name of ['width', 'depth', 'height', 'angle', 'drop']) form.elements[name].value = String(values[name]);
  for (const name of ['mount', 'roof', 'color']) {
    form.querySelector(`input[name="${name}"][value="${values[name]}"]`).checked = true;
  }
  for (const box of form.querySelectorAll('input[name="screens"]')) box.checked = values.screens.includes(box.value);
  form.elements.led.checked = values.led;
}

function readForm() {
  const data = new FormData(form);
  return normalize({
    width: data.get('width'),
    depth: data.get('depth'),
    height: data.get('height'),
    mount: data.get('mount'),
    roof: data.get('roof'),
    angle: data.get('angle'),
    color: data.get('color'),
    screens: data.getAll('screens'),
    drop: data.get('drop'),
    led: form.elements.led.checked,
  });
}

function itemLabel(item) {
  return tr(`item.${item.key}`, { area: number(item.area ?? 0), length: item.length ? formatLength(item.length, lang) : '' });
}

function specRows(values) {
  const roof = values.roof === 'lamele' ? `${tr('roof.lamele')}, ${values.angle}°` : tr(`roof.${values.roof}`);
  const screens = values.screens.length ? values.screens.map((side) => tr(`side.${side}`)).join(', ') : tr('value.none');
  return [
    [tr('size.width'), formatLength(values.width, lang)],
    [tr('size.depth'), formatLength(values.depth, lang)],
    [tr('size.height'), formatLength(values.height, lang)],
    [tr('step.mount'), tr(`mount.${values.mount}`)],
    [tr('step.roof'), roof],
    [tr('step.color'), tr(`color.${values.color}`)],
    [tr('extras.screens'), screens],
    [tr('extras.led'), values.led ? tr('value.yes') : tr('value.none')],
  ];
}

function shareUrl() {
  const url = new URL(location.href);
  url.search = `?${toQuery(config)}${lang === 'pl' ? '' : `&j=${lang}`}`;
  url.hash = '';
  return url.toString();
}

function render() {
  config = readForm();
  viewer?.update(config);
  document.getElementById('szerokosc-wartosc').textContent = formatLength(config.width, lang);
  document.getElementById('wysieg-wartosc').textContent = formatLength(config.depth, lang);
  document.getElementById('wysokosc-wartosc').textContent = formatLength(config.height, lang);
  document.getElementById('kat-wartosc').textContent = `${config.angle}°`;
  document.getElementById('opuszczenie-wartosc').textContent = `${config.drop}%`;
  document.getElementById('kat-pole').hidden = config.roof !== 'lamele';
  document.getElementById('rolety-pole').hidden = config.screens.length === 0;

  const result = quote(config, CURRENCY[lang]);
  document.getElementById('cena').textContent = formatMoney(result.total, lang);
  document.getElementById('rozbicie').innerHTML = result.items
    .map((item) => `<li><span>${escapeHtml(itemLabel(item))}</span><span>${formatMoney(item.amount, lang)}</span></li>`)
    .join('');
  history.replaceState(null, '', `${new URL(shareUrl()).search}${location.hash}`);
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.title = tr('meta.title');
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = tr(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-aria]')) element.setAttribute('aria-label', tr(element.dataset.i18nAria));
  for (const button of document.querySelectorAll('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  render();
}

function toggle(id, apply) {
  const button = document.getElementById(id);
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    apply(on);
  });
}

function showError(name, key) {
  const input = document.getElementById(`f-${name}`);
  const error = document.getElementById(`f-${name}-error`);
  error.textContent = key ? tr(key) : '';
  input.setAttribute('aria-invalid', String(Boolean(key)));
}

function openQuote() {
  snapshot = viewer?.snapshot() ?? '';
  const preview = document.getElementById('podglad');
  preview.hidden = !snapshot;
  if (snapshot) {
    preview.src = snapshot;
    preview.alt = tr('view.aria');
  }
  document.getElementById('podsumowanie').innerHTML = specRows(config)
    .map(([label, value]) => `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`)
    .join('');
  document.getElementById('cena-zapytanie').textContent = `${tr('summary.title')}: ${formatMoney(quote(config, CURRENCY[lang]).total, lang)}`;
  document.getElementById('zapytanie-tresc').hidden = false;
  document.getElementById('zapytanie-gotowe')?.remove();
  dialog.showModal();
}

function fillPrintSheet() {
  const result = quote(config, CURRENCY[lang]);
  document.getElementById('wydruk').innerHTML = `
    <h1>${escapeHtml(tr('print.title'))} · Cieniste</h1>
    <p>${escapeHtml(tr('print.date'))}: ${new Intl.DateTimeFormat(LOCALE[lang]).format(new Date())}</p>
    ${snapshot ? `<img src="${snapshot}" alt="">` : ''}
    <div class="print-columns">
      <table>${specRows(config).map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>
      <div>
        <h2>${escapeHtml(tr('print.price'))}: ${formatMoney(result.total, lang)}</h2>
        <table>${result.items.map((item) => `<tr><td>${escapeHtml(itemLabel(item))}</td><td>${formatMoney(item.amount, lang)}</td></tr>`).join('')}</table>
        <p>${escapeHtml(tr('summary.note'))}</p>
      </div>
    </div>
    <p class="print-link">${escapeHtml(tr('print.link'))}: ${escapeHtml(shareUrl())}</p>`;
}

function printSummary() {
  fillPrintSheet();
  dialog.close();
  window.print();
}

// Printing with Ctrl+P gives the same one-page summary of the current configuration.
window.addEventListener('beforeprint', () => {
  snapshot = viewer?.snapshot() ?? snapshot;
  fillPrintSheet();
});

function showDone(name) {
  document.getElementById('zapytanie-tresc').hidden = true;
  const done = document.createElement('div');
  done.className = 'quote-done';
  done.id = 'zapytanie-gotowe';
  done.innerHTML = `
    <h2 tabindex="-1">${escapeHtml(tr('done.title', { name: String(name).trim().split(/\s+/)[0] }))}</h2>
    <p>${escapeHtml(tr('done.text'))}</p>
    <div class="quote-actions">
      <button type="button" class="btn btn-primary" data-print>${escapeHtml(tr('done.pdf'))}</button>
      <button type="button" class="btn btn-ghost" data-close>${escapeHtml(tr('done.close'))}</button>
    </div>`;
  document.getElementById('zapytanie-tresc').after(done);
  done.querySelector('h2').focus();
}

writeForm(config);
applyLanguage();

form.addEventListener('input', render);
form.addEventListener('change', render);
form.addEventListener('submit', (event) => event.preventDefault());

for (const button of document.querySelectorAll('[data-lang]')) {
  button.addEventListener('click', () => {
    lang = button.dataset.lang;
    applyLanguage();
  });
}
for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => viewer?.view(button.dataset.view));
}
toggle('obracaj', (on) => viewer?.setAutoRotate(on));
toggle('wieczor', (on) => viewer?.setNight(on));

document.getElementById('kopiuj').addEventListener('click', async () => {
  const status = document.getElementById('kopiuj-status');
  try {
    await navigator.clipboard.writeText(shareUrl());
    status.textContent = tr('summary.copied');
  } catch {
    status.textContent = shareUrl();
  }
});

document.getElementById('wyslij').addEventListener('click', openQuote);
dialog.addEventListener('click', (event) => {
  if (event.target === dialog || event.target.closest('[data-close]')) dialog.close();
  if (event.target.closest('[data-print]')) printSummary();
});
quoteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(quoteForm));
  values.consent = quoteForm.elements.consent.checked;
  const errors = validateQuote(values);
  for (const name of FIELDS) showError(name, errors[name]);
  const first = FIELDS.find((name) => errors[name]);
  if (first) {
    document.getElementById(`f-${first}`).focus();
    return;
  }
  showDone(values.name);
});
for (const name of FIELDS) {
  quoteForm.elements[name].addEventListener('input', () => showError(name, ''));
}

// The 3D part loads separately, so the configurator and price still work where WebGL is unavailable.
// Textures are drawn in small steps while it loads, so the page stays responsive.
import('./scene.js')
  .then(({ createViewer }) => createViewer(canvas))
  .then((created) => {
    viewer = created;
    viewer.update(config);
    // Buttons pressed while the model was still loading.
    viewer.setNight(document.getElementById('wieczor').getAttribute('aria-pressed') === 'true');
    viewer.setAutoRotate(document.getElementById('obracaj').getAttribute('aria-pressed') === 'true');
    document.getElementById('widok').classList.add('is-ready');
  })
  .catch(() => {
    canvas.hidden = true;
    document.getElementById('brak-3d').hidden = false;
  });
