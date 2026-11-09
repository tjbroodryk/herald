// The standard shadcn helper. Users already have it; registry files import it as "@/lib/utils".
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
