import type { Catalog } from '../core';
import type { PageKey } from './page.en';

export const pageAr: Catalog<PageKey> = {
  'chip.protected': 'محمي',
  'chip.reason.explicit': 'محتوى صريح',
  'chip.reason.illustrated': 'رسم صريح',
  'chip.reason.suggestive': 'محتوى غير لائق',
  'chip.reason.faces': 'وجوه مخفية',
  'chip.reason.people': 'أشخاص مخفيون',
  'chip.reason.unverified': 'تعذّر التحقق',
  'chip.reason.manual': 'أخفيتَه بنفسك',
  'chip.show': 'إظهار',
  'chip.hold': 'اضغط مطوّلًا للإظهار',
  'chip.confirm': 'هل تريد إظهار هذا المحتوى؟',
  'chip.cancel': 'إلغاء',
  'chip.hide': 'إخفاء مجددًا',
  'chip.disabled': 'الإظهار معطّل',
  'chip.label': 'Veil: وسائط محمية',
  'announce.image': 'صورة محمية. اضغط {shortcut} لإظهارها.',
  'announce.video': 'فيديو محمي. اضغط {shortcut} لإظهاره.',
  'announce.disabled': 'وسائط محمية. الإظهار معطّل في إعدادات Veil.',
  'announce.revealed': 'تم الإظهار.',
  'announce.hidden': 'تم الإخفاء مجددًا.',
  'menu.hide': 'إخفاء باستخدام Veil',
  'menu.show': 'إظهار (Veil)',
};
