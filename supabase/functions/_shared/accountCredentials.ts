// Dependency-free account helpers shared by the account Edge Functions.
// Kept separate from accounts.ts so Node tests can import them without the
// Supabase client dependency.
export const initialPassword = "513base123";

export function studentId(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function validStudentId(value: string) {
  return /^[a-z0-9_-]{2,32}$/.test(value);
}

export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && value.length <= 128
    && /[A-Za-z]/.test(value) && /[0-9]/.test(value) && value !== initialPassword;
}

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
