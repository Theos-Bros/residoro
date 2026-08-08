import 'dotenv/config';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Throwaway helper for tb-notifications-task-due-reminder-001's live UI
// verification -- resets the existing billing-verify-member test account's
// password to a known value so the Notifications page can be checked in a
// real browser session without a magic-link email round trip.
// Run via (from application/backend): npx tsx src/scripts/reset-notif-verify-password.ts
const USER_ID = '0aa5a01e-a689-4469-8148-8c741557a035'; // danielbacud+billing-verify-member@gmail.com
const PASSWORD = 'NotifVerify-2026-08-08!';

const { error } = await supabaseAdmin.auth.admin.updateUserById(USER_ID, { password: PASSWORD });
if (error) throw new Error(error.message);
console.log('Password reset OK');
