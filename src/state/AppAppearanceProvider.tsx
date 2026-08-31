import type { PropsWithChildren } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useColorScheme } from "react-native";

import type { TextSize, ThemeMode } from "../features/medicationAppApi";
import { medicationAppApi } from "../features/medicationAppApi";
import { darkColors, lightColors, type AppColors } from "../ui/theme";

type AppearanceContextValue = {
  themeMode: ThemeMode;
  textSize: TextSize;
  colors: AppColors;
  textScale: number;
  resolvedTheme: "light" | "dark";
  applyPreferences: (themeMode: ThemeMode, textSize: TextSize) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

const textScales: Record<TextSize, number> = {
  standard: 1,
  large: 1.15,
  extra_large: 1.3,
};

export function AppAppearanceProvider({ children }: PropsWithChildren) {
  const systemTheme = useColorScheme();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [textSize, setTextSize] = useState<TextSize>("standard");
  const resolvedTheme = themeMode === "system" ? (systemTheme === "dark" ? "dark" : "light") : themeMode;

  useEffect(() => {
    let active = true;
    const load = () => {
      // The provider mounts before the encrypted runtime has finished opening.
      // Start the capability lookup inside the promise chain so a synchronous
      // "not ready" result is handled like every other recoverable startup race.
      void Promise.resolve()
        .then(() => medicationAppApi.getPreferences())
        .then((preferences) => {
          if (!active) return;
          setThemeMode(preferences.themeMode);
          setTextSize(preferences.textSize);
        })
        .catch(() => undefined);
    };
    load();
    const unsubscribe = medicationAppApi.subscribe(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AppearanceContextValue>(
    () => ({
      themeMode,
      textSize,
      resolvedTheme,
      colors: resolvedTheme === "dark" ? darkColors : lightColors,
      textScale: textScales[textSize],
      applyPreferences: (nextThemeMode, nextTextSize) => {
        setThemeMode(nextThemeMode);
        setTextSize(nextTextSize);
      },
    }),
    [resolvedTheme, textSize, themeMode],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("AppAppearanceProvider is missing");
  return value;
}
