function cookieLines(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,=\s]+=[^;,]*)/);
}

export class CookieJar {
  #cookies = new Map();

  absorb(headers) {
    for (const line of cookieLines(headers)) {
      const [pair, ...attributes] = line.split(";");
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const expired = attributes.some((attribute) => {
        const normalized = attribute.trim().toLowerCase();
        return normalized === "max-age=0"
          || (normalized.startsWith("expires=") && Date.parse(attribute.slice(attribute.indexOf("=") + 1)) <= Date.now());
      });
      if (expired || !value) this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  header() {
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get size() {
    return this.#cookies.size;
  }
}
