import { describe, it, expect } from 'vitest';

/**
 * Documents the mapping applied in AuthPage.handleRegister when the
 * backend trigger `enforce_signup_allowlist_trigger` rejects a signup.
 *
 * The trigger raises with message "Registro no permitido. ...". Supabase
 * Auth wraps backend errors as "Database error saving new user"
 * (unexpected_failure). The UI must collapse ALL of these to a single,
 * non-enumerable message.
 */

function mapSignupError(message: string): string {
  const msg = (message || '').toLowerCase();
  const isAllowlistRejection =
    msg.includes('registro no permitido') ||
    msg.includes('database error') ||
    msg.includes('unexpected_failure');
  return isAllowlistRejection
    ? 'No ha sido posible completar el registro. Si crees que deberías tener acceso, contacta con un administrador.'
    : message;
}

describe('signup allowlist UI message', () => {
  it('collapses direct trigger rejection to generic message', () => {
    expect(mapSignupError('Registro no permitido. Solicita acceso a un administrador.'))
      .toMatch(/No ha sido posible completar el registro/);
  });

  it('collapses Supabase-wrapped "Database error" to generic message', () => {
    expect(mapSignupError('Database error saving new user'))
      .toMatch(/No ha sido posible completar el registro/);
  });

  it('collapses unexpected_failure code', () => {
    expect(mapSignupError('AuthApiError: unexpected_failure'))
      .toMatch(/No ha sido posible completar el registro/);
  });

  it('does NOT leak whether the email is in the allowlist', () => {
    const allowed = mapSignupError('Database error saving new user');
    const denied = mapSignupError('Registro no permitido. Solicita acceso a un administrador.');
    expect(allowed).toBe(denied);
  });

  it('passes through unrelated errors unchanged (e.g. password too short)', () => {
    expect(mapSignupError('Password should be at least 6 characters'))
      .toBe('Password should be at least 6 characters');
  });
});
