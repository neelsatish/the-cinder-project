export type CinderTheme = "light" | "dark" | "paper";

export function normaliseCinderTheme(value: unknown): CinderTheme {
  return value === "dark" || value === "paper" ? value : "light";
}
