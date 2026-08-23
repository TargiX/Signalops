import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(value < 1
        ? { minimumFractionDigits: 3, maximumFractionDigits: 4 }
        : { maximumFractionDigits: value >= 100 ? 0 : 2 }),
    }).format(value);
  } catch {
    return `${value.toFixed(value < 1 ? 4 : 2)} ${currency}`;
  }
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatMs(value: number) {
  if (value < 1000) {
    return `${Math.round(value)}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
}
