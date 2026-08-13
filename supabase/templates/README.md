# Riink authentication email templates

These templates mirror the visual direction of the Riink authentication UI:

- Geist with system fallbacks;
- ink `#17211b` and Riink green `#1f6547`;
- soft page background `#f7f9f7`;
- compact content with one primary action;
- support and cookie links in the footer.

## Hosted Supabase setup

The entries in `supabase/config.toml` configure local development only. For the
hosted project, copy each subject and HTML file into **Authentication > Emails >
Templates** in the Supabase dashboard.

| Supabase template | Subject | File |
| --- | --- | --- |
| Confirm signup | Confirm your Riink email | `confirmation.html` |
| Reset password | Reset your Riink password | `recovery.html` |
| Invite user | You are invited to Riink | `invite.html` |
| Magic link | Your secure Riink sign in link | `magic-link.html` |
| Change email address | Confirm your new Riink email | `email-change.html` |
| Reauthentication | Your Riink verification code | `reauthentication.html` |

Keep Resend link tracking disabled for authentication emails. Link rewriting can
invalidate Supabase confirmation URLs.

After publishing, test signup, password recovery, invitation, and email change
with real inboxes on both desktop and mobile.
