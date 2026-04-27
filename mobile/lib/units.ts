// User-facing distance units. Mirror of src/lib/units.js for the mobile app.
// Auto-detected from device locale (US/Liberia → imperial), persisted via
// AsyncStorage, and exposed through a useUnits() hook.

import { useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Units = 'metric' | 'imperial';

const STORAGE_KEY = 'units';
export const KM_PER_MILE = 1.609344;
export const FEET_PER_MILE = 5280;

const listeners = new Set<(u: Units) => void>();
let cached: Units | null = null;
let hydrated = false;
let hydratePromise: Promise<Units> | null = null;

function deviceLocale(): string {
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      return settings?.AppleLocale
        || settings?.AppleLanguages?.[0]
        || 'en-US';
    }
    return NativeModules.I18nManager?.localeIdentifier || 'en-US';
  } catch {
    return 'en-US';
  }
}

function detectFromLocale(): Units {
  const loc = deviceLocale();
  return /^en[_-](US|LR)/i.test(loc) ? 'imperial' : 'metric';
}

export function getUnitsSync(): Units {
  return cached ?? detectFromLocale();
}

function hydrate(): Promise<Units> {
  if (hydrated) return Promise.resolve(cached!);
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      cached = (stored === 'metric' || stored === 'imperial') ? stored : detectFromLocale();
    } catch {
      cached = detectFromLocale();
    }
    hydrated = true;
    return cached;
  })();
  return hydratePromise;
}

export async function setUnits(units: Units) {
  if (units !== 'metric' && units !== 'imperial') return;
  cached = units;
  hydrated = true;
  try { await AsyncStorage.setItem(STORAGE_KEY, units); } catch {}
  listeners.forEach(fn => fn(units));
}

export function useUnits(): [Units, (u: Units) => void] {
  const [units, setUnitsState] = useState<Units>(getUnitsSync);
  useEffect(() => {
    let cancelled = false;
    hydrate().then(u => { if (!cancelled) setUnitsState(u); });
    const fn = (next: Units) => setUnitsState(next);
    listeners.add(fn);
    return () => { cancelled = true; listeners.delete(fn); };
  }, []);
  return [units, (u) => { void setUnits(u); }];
}

export function kmToMiles(km: number): number { return km / KM_PER_MILE; }
export function milesToKm(mi: number): number { return mi * KM_PER_MILE; }
