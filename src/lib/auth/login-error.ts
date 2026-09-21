import { isAuthServiceUnavailable } from './service-error'

export function loginErrorMessage(error: { code?: string; status?: number }): string {
  if (error.status === 429) return 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.'
  if (isAuthServiceUnavailable(error)) return 'Сервис входа временно недоступен. Попробуйте снова позже.'
  if (error.code === 'invalid_credentials') return 'Неверный email или пароль. Проверьте данные и попробуйте снова.'
  if (error.code === 'email_not_confirmed') return 'Подтвердите email по ссылке из письма перед входом.'
  if (error.code === 'user_banned') return 'Вход в аккаунт заблокирован. Обратитесь к администратору.'
  return 'Не удалось выполнить вход. Попробуйте снова или обратитесь к администратору.'
}
