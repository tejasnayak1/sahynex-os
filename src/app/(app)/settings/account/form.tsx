'use client';
import { ActionForm, FormField, SubmitButton } from '@/components/client/action-form';
import { inputClass } from '@/components/ui';
import { passwordAction } from '../actions';

export function PasswordForm() {
  return (
    <ActionForm action={passwordAction} className="grid max-w-md gap-3">
      <FormField label="Current password" name="current" required>
        <input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </FormField>
      <FormField
        label="New password"
        name="next"
        required
        hint="At least 10 characters, mixing letters, numbers or symbols."
      >
        <input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className={inputClass}
        />
      </FormField>
      <FormField label="Confirm new password" name="confirm" required>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
      </FormField>
      <div>
        <SubmitButton>Change password</SubmitButton>
      </div>
    </ActionForm>
  );
}
