// js/core/validator.js
export function isEmail(value) {
  if (!value) return false;
  // simple but effective
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function passwordStrength(password) {
  const result = { valid: true, reasons: [] };
  if (!password || password.length < 8) {
    result.valid = false;
    result.reasons.push('At least 8 characters.');
  }
  if (!/[A-Z]/.test(password)) result.reasons.push('One uppercase letter.');
  if (!/[a-z]/.test(password)) result.reasons.push('One lowercase letter.');
  if (!/[0-9]/.test(password)) result.reasons.push('One number.');
  if (!/[^A-Za-z0-9]/.test(password))
    result.reasons.push('One special character.');
  if (result.reasons.length) result.valid = false;
  return result;
}

export function passwordsMatch(a, b) {
  return a === b;
}
