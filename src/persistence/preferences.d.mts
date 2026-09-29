export type OptionalBrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Preferences = Readonly<{
  getText(key: string, fallback?: string): string;
  setText(key: string, value: string): boolean;
  getJSON<T>(key: string, fallback: T, validate?: (value: unknown) => boolean): T;
  setJSON(key: string, value: unknown): boolean;
  remove(key: string): boolean;
}>;
export function browserStorage(kind?: "local" | "session"): OptionalBrowserStorage | undefined;
export function createPreferences(storage?: OptionalBrowserStorage): Preferences;
export const localPreferences: Preferences;
export const sessionPreferences: Preferences;
