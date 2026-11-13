export type AppLanguage = 'ru';

export function uiText(_language: AppLanguage | string, _english: string, russian: string): string {
  return russian;
}

export function faqText(
  _language: AppLanguage | string,
  item: {
    faq_id?: string;
    question_ru?: string;
    answer_ru?: string;
    question_en?: string;
    answer_en?: string;
  },
  field: 'question' | 'answer',
): string {
  const value = item[field + '_ru' as 'question_ru' | 'answer_ru'];
  return typeof value === 'string' ? value : '';
}
