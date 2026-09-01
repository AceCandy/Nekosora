# Self-service password change research

## Better Auth 1.6.23

- The repository lockfile resolves `better-auth` to 1.6.23.
- `packages/core/src/auth.ts` enables email/password authentication with an 8-character minimum and 128-character maximum.
- The installed `changePassword` endpoint requires an authenticated session and accepts `currentPassword`, `newPassword`, and optional `revokeOtherSessions`.
- It verifies the current credential password and reports `INVALID_PASSWORD` when verification fails.
- With `revokeOtherSessions: true`, Better Auth removes the user's sessions, creates a replacement session for the current client, sets its cookie, and returns the new token and user.
- The client should call `authClient.changePassword`; the administrator `setUserPassword` flow is not suitable because it does not verify the current password and targets a supplied user ID.

## Existing project patterns

- `apps/web/src/lib/auth-client.ts` exports a shared Better Auth client.
- `apps/web/src/app/(dash)/admin/users/ResetPasswordButton.tsx` demonstrates the existing Modal, Input, Button, validation, focus, accessibility, and pending-state patterns.
- `apps/web/src/features/chat/components/Sidebar.tsx` owns the chat account menu.
- `apps/web/src/shared/components/DashSidebar.tsx` owns the shared panel/admin account menu.
- The two menus are separate implementations, so each needs one trigger while the dialog and password-change logic remain shared.
- Localized self-service copy should live outside the administrator namespace and cover both Chinese and English.

## Constraints

- Preserve existing uncommitted user edits in `apps/web/src/features/chat/components/Sidebar.tsx`.
- Add no dependency, standalone settings page, or duplicate password form.
