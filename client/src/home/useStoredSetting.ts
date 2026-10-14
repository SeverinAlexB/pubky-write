import { useEffect, useState } from "react";

/** A setting remembered in the browser; unknown stored values fall back to `initial`. */
export function useStoredSetting<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    return allowed.includes(stored as T) ? (stored as T) : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue];
}
