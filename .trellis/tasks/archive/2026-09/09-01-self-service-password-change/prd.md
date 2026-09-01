# Self-service password change

## Goal

Allow the signed-in user to securely change their own password from the bottom-left account menu.

## Requirements

- The signed-in user can open a password-change dialog from the existing bottom-left account menu.
- The dialog requires the current password, a new password, and confirmation of the new password.
- The new password must respect the existing authentication limits of 8 to 128 characters, and the confirmation must match before submission.
- The password change must use Better Auth's authenticated self-service flow so the current password is verified; the administrator reset flow must not be reused.
- A successful change keeps the current device signed in and revokes the user's other sessions.
- Failures keep the dialog open, preserve entered values, present an accessible error message, and focus the field the user can correct.
- The dialog and account-menu entry must support the existing Chinese and English locales.
- Reuse the existing Modal, Input, Button, account-menu, and authentication-client patterns without adding dependencies or a standalone settings page.
- Expose the same shared dialog from both the chat and dashboard bottom-left account menus.

## Acceptance Criteria

- [x] An authenticated password user can open the shared dialog from both the chat and dashboard bottom-left account menus.
- [x] Empty, shorter-than-8, longer-than-128, or mismatched new passwords are rejected before the API request with the appropriate field focused.
- [x] Submission sends the current and new passwords through Better Auth's self-service `changePassword` API with other-session revocation enabled.
- [x] An incorrect current password produces a localized, accessible error without closing the dialog.
- [x] A successful change clears password fields, shows a confirmation in the dialog, and leaves the current browser session usable; closing restores focus to the account-menu button.
- [x] Chinese and English copy is available for the entry, dialog, validation, success, and failure states.
- [x] Targeted automated checks cover validation boundaries, request parameters, and success/error behavior.

## Notes

- Better Auth is locked to 1.6.23 and already exposes the authenticated `/change-password` endpoint.
- The chat `Sidebar` and dashboard `DashSidebar` have separate account-menu implementations but can open one shared dialog component.
- Existing user changes in `apps/web/src/features/chat/components/Sidebar.tsx` must be preserved with a surgical merge.
