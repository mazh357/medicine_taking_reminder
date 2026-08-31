export const lightColors = {
  background: "#F4F6F8",
  surface: "#FFFFFF",
  text: "#18212B",
  muted: "#5E6B78",
  primary: "#176B5B",
  primarySoft: "#DDEFEA",
  border: "#D8DEE4",
  warning: "#8A5A00",
  warningSoft: "#FFF1C7",
  danger: "#A02C2C",
  dangerSoft: "#FDE8E8",
  disabled: "#A9B2BB",
};

export const darkColors: typeof lightColors = {
  background: "#101417",
  surface: "#1A2025",
  text: "#F2F5F7",
  muted: "#AAB5BE",
  primary: "#65C7B4",
  primarySoft: "#183B35",
  border: "#354049",
  warning: "#F1C56B",
  warningSoft: "#433615",
  danger: "#FF9797",
  dangerSoft: "#4A2326",
  disabled: "#66717A",
};

/** Backward-compatible light palette for non-themed integration code. */
export const colors = lightColors;
export type AppColors = typeof lightColors;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};
