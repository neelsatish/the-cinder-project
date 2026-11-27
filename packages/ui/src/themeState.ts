export type CinderTheme = "light" | "dark";

/** The retired Paper theme (and anything unknown) falls back to Light. */
export function normaliseCinderTheme(value: unknown): CinderTheme {
  return value === "dark" ? "dark" : "light";
}
