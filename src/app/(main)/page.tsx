
import { redirect } from 'next/navigation';

export default function MainPageRedirect() {
  // 已登入的使用者如果訪問主應用程式區的根目錄，
  // 應該被重新導向至統一的新預約頁面。
  redirect('/new-reservation');
}
