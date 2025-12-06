
'use server';

import { redirect } from 'next/navigation';

// This page is now obsolete as the functionality has been merged into
// the /app/(main)/temporary-access page, which serves both VVIPs and Admins.
// Redirect any admins who land here to the new, consolidated page.
export default async function DoorControlPage() {
    redirect('/temporary-access');
}
