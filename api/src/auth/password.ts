import bcrypt from "bcryptjs";

// bcrypt (not argon2) specifically so password hashes dumped from Supabase's
// GoTrue (auth.users.encrypted_password, also bcrypt) verify unchanged after
// migration — no forced password resets for existing accounts.
const SALT_ROUNDS = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
