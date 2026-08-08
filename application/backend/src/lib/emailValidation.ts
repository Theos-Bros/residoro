// tb-client-lifecycle-disposable-email-block-001: shared by every
// account-creation entry point (member invite, admin client enrollment) so
// the format check and the disposable-domain blocklist live in one place
// instead of being duplicated per-route.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DISPOSABLE_DOMAINS = new Set<string>(require('disposable-email-domains') as string[]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailValidationResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_format' | 'disposable_domain' };

export function validateEmail(email: string): EmailValidationResult {
  if (!EMAIL_RE.test(email)) {
    return { ok: false, reason: 'invalid_format' };
  }

  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: 'disposable_domain' };
  }

  return { ok: true };
}
