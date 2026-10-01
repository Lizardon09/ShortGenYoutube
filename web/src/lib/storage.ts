// Same keys as the original static page, so saved settings carry over.
export const SETTINGS_KEY = "shortgen.settings";
export const JOBS_KEY = "shortgen.jobs";
export const TITLES_KEY = "shortgen.titles";
export const MODEL_KEY = "shortgen.model";

export function load<T>(key: string, fallback: T): T {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / storage blocked: the page still works for this visit.
  }
}

export function rememberTitle(id: string, title: string) {
  save(TITLES_KEY, { ...load<Record<string, string>>(TITLES_KEY, {}), [id]: title });
}
