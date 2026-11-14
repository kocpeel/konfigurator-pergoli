// Validation of the "send for a quote" form. Returns error keys that the page translates into the chosen language.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateQuote(values) {
  const text = (name) => String(values[name] ?? '').trim();
  const errors = {};
  if (text('name').length < 2) errors.name = 'error.name';
  const email = text('email');
  const phone = text('phone').replace(/[\s\-()+]/g, '');
  if (!email && !phone) errors.email = 'error.contact';
  if (email && !EMAIL.test(email)) errors.email = 'error.email';
  if (phone && !/^\d{9,13}$/.test(phone)) errors.phone = 'error.phone';
  if (!values.consent) errors.consent = 'error.consent';
  return errors;
}
