// Exact decimal helpers used by every server-owned customer financial calculation.
const ISO_CURRENCY_MINOR_UNITS = Object.freeze({
  AED:2,AFN:2,ALL:2,AMD:2,AOA:2,ARS:2,AUD:2,AWG:2,AZN:2,BAM:2,BBD:2,BDT:2,BHD:3,BIF:0,BMD:2,BND:2,BOB:2,BOV:2,
  BRL:2,BSD:2,BTN:2,BWP:2,BYN:2,BZD:2,CAD:2,CDF:2,CHE:2,CHF:2,CHW:2,CLF:4,CLP:0,CNY:2,COP:2,COU:2,CRC:2,CUP:2,
  CVE:2,CZK:2,DJF:0,DKK:2,DOP:2,DZD:2,EGP:2,ERN:2,ETB:2,EUR:2,FJD:2,FKP:2,GBP:2,GEL:2,GHS:2,GIP:2,GMD:2,GNF:0,
  GTQ:2,GYD:2,HKD:2,HNL:2,HTG:2,HUF:2,IDR:2,ILS:2,INR:2,IQD:3,IRR:2,ISK:0,JMD:2,JOD:3,JPY:0,KES:2,KGS:2,KHR:2,
  KMF:0,KPW:2,KRW:0,KWD:3,KYD:2,KZT:2,LAK:2,LBP:2,LKR:2,LRD:2,LSL:2,LYD:3,MAD:2,MDL:2,MGA:2,MKD:2,MMK:2,MNT:2,
  MOP:2,MRU:2,MUR:2,MVR:2,MWK:2,MXN:2,MXV:2,MYR:2,MZN:2,NAD:2,NGN:2,NIO:2,NOK:2,NPR:2,NZD:2,OMR:3,PAB:2,PEN:2,
  PGK:2,PHP:2,PKR:2,PLN:2,PYG:0,QAR:2,RON:2,RSD:2,RUB:2,RWF:0,SAR:2,SBD:2,SCR:2,SDG:2,SEK:2,SGD:2,SHP:2,SLE:2,
  SOS:2,SRD:2,SSP:2,STN:2,SVC:2,SYP:2,SZL:2,THB:2,TJS:2,TMT:2,TND:3,TOP:2,TRY:2,TTD:2,TWD:2,TZS:2,UAH:2,UGX:0,
  USD:2,USN:2,UYI:0,UYU:2,UYW:4,UZS:2,VED:2,VES:2,VND:0,VUV:0,WST:2,XAD:2,XAF:0,XCD:2,XCG:2,XOF:0,XPF:0,
  YER:2,ZAR:2,ZMW:2,ZWG:2,
});

export const power10 = (value) => 10n ** BigInt(value);

function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

export function fraction(numerator, denominator = 1n) {
  if (denominator === 0n) throw new Error("Cannot divide by zero.");
  const sign = denominator < 0n ? -1n : 1n;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor * sign, denominator: denominator / divisor * sign };
}

export function addFraction(left, right) {
  return fraction(left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator);
}

export function multiplyFraction(left, right) {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divideFraction(left, right) {
  return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function parseFinancialDecimal(value, { maximumScale = 12, maximumIntegerDigits = 12, signed = false } = {}) {
  const text = String(value ?? "").trim();
  const match = new RegExp(`^${signed ? "(-?)" : ""}(\\d+)(?:\\.(\\d+))?$`).exec(text);
  if (!match) throw new Error("Invalid decimal value.");
  const sign = signed ? (match[1] === "-" ? -1n : 1n) : 1n;
  const whole = match[signed ? 2 : 1];
  const decimals = match[signed ? 3 : 2] || "";
  if (whole.length > maximumIntegerDigits || decimals.length > maximumScale) throw new Error("Invalid decimal value.");
  return fraction(sign * BigInt(`${whole}${decimals}`), power10(decimals.length));
}

export function roundHalfUp(value, digits = 0) {
  const scaled = value.numerator * power10(digits);
  const quotient = scaled / value.denominator;
  const remainder = scaled % value.denominator;
  const absoluteRemainder = remainder < 0n ? -remainder : remainder;
  if (absoluteRemainder * 2n < value.denominator) return quotient;
  return quotient + (scaled < 0n ? -1n : 1n);
}

export function formatMinorUnits(value, minorDigits) {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  if (minorDigits === 0) return `${sign}${absolute}`;
  const digits = absolute.toString().padStart(minorDigits + 1, "0");
  return `${sign}${digits.slice(0, -minorDigits)}.${digits.slice(-minorDigits)}`;
}

export function normalizeFinancialDecimal(value) {
  const text = String(value).trim();
  if (!text.includes(".")) return text;
  return text.replace(/0+$/, "").replace(/\.$/, "");
}

export function isSupportedFinancialCurrency(value) {
  return Object.hasOwn(ISO_CURRENCY_MINOR_UNITS, String(value || "").trim().toUpperCase());
}

export function currencyMinorDigits(currency) {
  const code = String(currency || "").trim().toUpperCase();
  if (!isSupportedFinancialCurrency(code)) throw new Error("Unsupported currency.");
  return ISO_CURRENCY_MINOR_UNITS[code];
}

export function percentageFraction(rate) {
  return divideFraction(parseFinancialDecimal(rate, { maximumScale: 4, maximumIntegerDigits: 3 }), fraction(100n));
}
