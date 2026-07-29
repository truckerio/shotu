-- Keep applied kiosk schema history immutable while documenting the current
-- variable-length numeric PIN policy.

comment on table mechanic_kiosk_credentials is
  'Company-scoped numeric mechanic PIN verifiers hashed with Better Auth scrypt.';
