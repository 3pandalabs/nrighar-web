// Applied server-side regardless of what the model already did to the text
// it returned — never trust the model itself for redaction. Any input that
// isn't a clean 12-digit Aadhaar number is masked in full rather than
// partially, so a misparse never leaks more digits than intended.
export function maskAadhaarNumber(raw: string | null): string | null {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return "XXXX-XXXX-XXXX";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}
