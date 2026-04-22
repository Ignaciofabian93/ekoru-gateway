export type SupportedLanguage = string;
export const DEFAULT_LANGUAGE: SupportedLanguage = 'ES';

type TranslationMap = Record<string, string>;

export const translations: Record<string, TranslationMap> = {
  ES: {
    'auth.user_not_found': 'No se encontró al usuario',
    'auth.admin_not_found': 'No se encontró al administrador',
    'auth.invalid_credentials': 'Credenciales inválidas',
    'auth.account_disabled': 'La cuenta está desactivada',
    'auth.account_locked': 'La cuenta está bloqueada',
    'auth.login_success': 'Inicio de sesión exitoso',
    'auth.session_closed': 'Sesión cerrada exitosamente',
    'auth.token_refresh_failed': 'No se pudo generar un nuevo token de acceso',
    'auth.token_invalid': 'Token de acceso inválido',
    'auth.token_revoked': 'El token de actualización ha sido revocado',
  },
  EN: {
    'auth.user_not_found': 'User not found',
    'auth.admin_not_found': 'Admin not found',
    'auth.invalid_credentials': 'Invalid credentials',
    'auth.account_disabled': 'Account is disabled',
    'auth.account_locked': 'Account is locked',
    'auth.login_success': 'Login successful',
    'auth.session_closed': 'Session closed successfully',
    'auth.token_refresh_failed': 'Could not generate a new access token',
    'auth.token_invalid': 'Invalid access token',
    'auth.token_revoked': 'Refresh token has been revoked',
  },
};
