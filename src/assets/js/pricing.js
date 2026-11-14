// Price tables of the fictional company. In a real deployment these come from the client's own price list;
// keeping them in one object means a new price list is a change of numbers, not of code.

export const PRICES = {
  PLN: {
    roofPerM2: { poliweglan: 1100, szklo: 1650, lamele: 2450 },
    freestanding: 1400,
    screenPerM: 520,
    ledPerM: 190,
    montage: 1500,
    roundTo: 10,
  },
  EUR: {
    roofPerM2: { poliweglan: 260, szklo: 390, lamele: 580 },
    freestanding: 330,
    screenPerM: 125,
    ledPerM: 45,
    montage: 360,
    roundTo: 5,
  },
};

// Wood-effect powder coating costs more than plain RAL colours.
export const COLOR_SURCHARGE = { drewno: 0.12 };

export function quote(config, currency = 'PLN') {
  const table = PRICES[currency];
  if (!table) throw new Error(`Nieznana waluta: ${currency}`);
  const area = Math.round(config.width * config.depth * 100) / 100;
  const items = [];
  const structure = area * table.roofPerM2[config.roof];
  items.push({ key: 'structure', amount: structure, area });
  if (config.mount === 'wolnostojaca') items.push({ key: 'freestanding', amount: table.freestanding });
  const surcharge = COLOR_SURCHARGE[config.color] ?? 0;
  if (surcharge) items.push({ key: 'color', amount: structure * surcharge });
  for (const side of config.screens) {
    const length = side === 'front' ? config.width : config.depth;
    items.push({ key: `screen-${side}`, amount: length * table.screenPerM, length });
  }
  if (config.led) {
    const length = config.width + 2 * config.depth;
    items.push({ key: 'led', amount: length * table.ledPerM, length });
  }
  items.push({ key: 'montage', amount: table.montage });
  for (const item of items) item.amount = Math.round(item.amount);
  const sum = items.reduce((total, item) => total + item.amount, 0);
  return { currency, area, items, total: Math.round(sum / table.roundTo) * table.roundTo };
}
