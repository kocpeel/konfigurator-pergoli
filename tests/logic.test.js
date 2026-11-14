import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULTS, fromQuery, normalize, snap, toQuery } from '../src/assets/js/config.js';
import { validateQuote } from '../src/assets/js/form-core.js';
import { formatLength, formatMoney, keys, t } from '../src/assets/js/i18n.js';
import { quote } from '../src/assets/js/pricing.js';

const space = (text) => text.replace(/\s/g, ' ');

describe('konfiguracja', () => {
  it('przycina wartości do zakresu i kroku', () => {
    assert.equal(snap('4.3', { min: 3, max: 7, step: 0.5 }, 4), 4.5);
    assert.equal(snap('2,73', { min: 2.2, max: 3, step: 0.1 }, 2.5), 2.7);
    assert.equal(snap(99, { min: 3, max: 7, step: 0.5 }, 4), 7);
    assert.equal(snap('abc', { min: 3, max: 7, step: 0.5 }, 4), 4);
    assert.equal(snap('', { min: 3, max: 7, step: 0.5 }, 4), 4);
  });

  it('uzupełnia braki domyślnymi wartościami i odrzuca nieznane opcje', () => {
    assert.deepEqual(normalize({}), { ...DEFAULTS, screens: [] });
    const config = normalize({ roof: 'strzecha', color: 'różowy', mount: 'wolnostojaca', screens: 'prawa,dach,front', led: '1' });
    assert.equal(config.roof, 'poliweglan');
    assert.equal(config.color, '7016');
    assert.equal(config.mount, 'wolnostojaca');
    assert.deepEqual(config.screens, ['front', 'prawa']);
    assert.equal(config.led, true);
  });

  it('zapisuje konfigurację w linku i odczytuje ją bez zmian', () => {
    const config = normalize({ width: 5.5, depth: 4, height: 2.8, mount: 'wolnostojaca', roof: 'lamele', angle: 45, color: 'drewno', screens: ['lewa', 'front'], drop: 40, led: true });
    const query = toQuery(config);
    assert.match(query, /^s=5\.5&g=4&w=2\.8&m=wolnostojaca&d=lamele&k=45&c=drewno&z=front%2Clewa&o=40&l=1$/);
    assert.deepEqual(fromQuery(`?${query}`), config);
    assert.deepEqual(fromQuery('?s=100&d=lamele'), { ...DEFAULTS, width: 7, roof: 'lamele', screens: [] });
  });
});

describe('cena', () => {
  it('liczy domyślną pergolę 4 × 3 m z poliwęglanem', () => {
    const result = quote(normalize({}), 'PLN');
    assert.equal(result.area, 12);
    assert.deepEqual(result.items.map((item) => [item.key, item.amount]), [['structure', 13200], ['montage', 1500]]);
    assert.equal(result.total, 14700);
  });

  it('dolicza lamele, kolor drewnopodobny, rolety, LED i słupy', () => {
    const config = normalize({ roof: 'lamele', color: 'drewno', mount: 'wolnostojaca', screens: ['front', 'lewa'], led: true });
    const amounts = Object.fromEntries(quote(config, 'PLN').items.map((item) => [item.key, item.amount]));
    assert.deepEqual(amounts, {
      structure: 29400, freestanding: 1400, color: 3528, 'screen-front': 2080, 'screen-lewa': 1560, led: 1900, montage: 1500,
    });
    assert.equal(quote(config, 'PLN').total, 41370);
  });

  it('ma osobny cennik w euro', () => {
    assert.equal(quote(normalize({}), 'EUR').total, 3480);
    assert.throws(() => quote(normalize({}), 'USD'), /waluta/);
  });
});

describe('formularz zapytania', () => {
  it('wymaga imienia, kontaktu i zgody', () => {
    assert.deepEqual(validateQuote({ name: 'Ola Nowak', email: 'ola@example.com', consent: true }), {});
    assert.deepEqual(validateQuote({ name: 'Ola Nowak', phone: '+48 600 000 000', consent: true }), {});
    assert.deepEqual(validateQuote({ name: 'O', consent: false }), { name: 'error.name', email: 'error.contact', consent: 'error.consent' });
    assert.deepEqual(validateQuote({ name: 'Ola', email: 'ola@', phone: '12', consent: true }), { email: 'error.email', phone: 'error.phone' });
  });
});

describe('tłumaczenia', () => {
  it('wersja niemiecka ma wszystkie teksty polskiej', () => {
    assert.deepEqual(keys('de').sort(), keys('pl').sort());
  });

  it('wstawia wartości i formatuje kwoty po polsku i po niemiecku', () => {
    assert.equal(t('pl', 'done.title', { name: 'Ola' }), 'Dziękujemy, Ola!');
    assert.equal(space(formatMoney(14700, 'pl')), '14 700 zł');
    assert.equal(space(formatMoney(3480, 'de')), '3.480 €');
    assert.equal(formatLength(4, 'pl'), '4,0 m');
  });
});
