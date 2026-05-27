import { redirect } from 'next/navigation';

/** Admin 預設首頁：登入後進入預訂管理。 */
export default function AdminHomePage() {
  redirect('/admin/bookings');
}
