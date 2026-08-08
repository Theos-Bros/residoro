import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Renders a lowercase/snake_case enum value (e.g. "in_progress") as
// "In progress" for dropdown option text -- underscores become spaces and
// only the first letter is capitalized, matching how the rest of the app
// already displays these values as running text (not Title Case per word).
export function toSentenceCase(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
