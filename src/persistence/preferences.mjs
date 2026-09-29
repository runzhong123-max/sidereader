// Preferences and unsent drafts are optional browser storage. Failure here must
// leave the in-memory UI usable. Project records use the strict repository API.
export function browserStorage(kind = "local") {
  if (typeof window === "undefined") return undefined;
  try {
    return kind === "session" ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createPreferences(storage) {
  const getText = (key, fallback = "") => {
    try { return storage?.getItem(key) ?? fallback; } catch { return fallback; }
  };
  const setText = (key, value) => {
    try {
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch { return false; }
  };
  return Object.freeze({
    getText,
    setText,
    getJSON(key, fallback, validate) {
      try {
        const text = getText(key);
        if (!text) return fallback;
        const value = JSON.parse(text);
        return !validate || validate(value) ? value : fallback;
      } catch { return fallback; }
    },
    setJSON(key, value) {
      try {
        const text = JSON.stringify(value);
        return text === undefined ? false : setText(key, text);
      } catch { return false; }
    },
    remove(key) {
      try {
        if (!storage) return false;
        storage.removeItem(key);
        return true;
      } catch { return false; }
    },
  });
}

export const localPreferences = createPreferences(browserStorage());
export const sessionPreferences = createPreferences(browserStorage("session"));
