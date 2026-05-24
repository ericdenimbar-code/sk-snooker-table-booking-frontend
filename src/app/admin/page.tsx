import { redirect } from 'next/navigation';

/** 舊 /admin 書籤與連結：伺服器端一次導向，避免 client 與側欄形成重導向迴圈。 */
export default function AdminPage() {
  redirect('/admin/bookings');
}
