import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSmtpMailer, resolveSmtpConfig } from "../email/smtp.js";

const authSource = readFileSync(new URL("./auth.js", import.meta.url), "utf8");

test("password recovery uses short-lived Better Auth tokens and revokes sessions", () => {
  assert.match(authSource, /resetPasswordTokenExpiresIn:\s*60 \* 15/);
  assert.match(authSource, /revokeSessionsOnPasswordReset:\s*true/);
  assert.match(authSource, /sendResetPassword:\s*sendPasswordResetEmail/);
  assert.match(authSource, /"\/request-password-reset":\s*\{\s*window:\s*60,\s*max:\s*5\s*\}/);
  assert.doesNotMatch(authSource, /"\/forget-password"/);
});

test("SMTP config remains disabled until every credential is present", () => {
  assert.equal(resolveSmtpConfig({ SMTP_HOST: "smtp.example.com" }).enabled, false);
  assert.deepEqual(
    resolveSmtpConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "sender@example.com",
      SMTP_PASS: "secret",
      MAIL_FROM_NAME: "Workorder",
    }),
    {
      enabled: true,
      host: "smtp.example.com",
      port: 465,
      secure: true,
      user: "sender@example.com",
      password: "secret",
      fromEmail: "sender@example.com",
      fromName: "Workorder",
    },
  );
  assert.equal(resolveSmtpConfig({
    SMTP_HOST: "smtp.example.com",
    SMTP_SECURE: "SSL",
    SMTP_USER: "sender@example.com",
    SMTP_PASS: "secret",
  }).secure, true);
});

test("SMTP sender separates display identity from authenticated transport", async () => {
  let transportOptions;
  let message;
  const mailer = createSmtpMailer(
    {
      enabled: true,
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "transport@example.com",
      password: "secret",
      fromEmail: "verified-alias@example.com",
      fromName: "Workorder",
    },
    (options) => {
      transportOptions = options;
      return {
        async sendMail(input) {
          message = input;
          return { messageId: "test" };
        },
      };
    },
  );

  await mailer.send({
    to: "user@example.com",
    subject: "Reset",
    text: "Reset text",
    html: "<p>Reset</p>",
  });

  assert.equal(transportOptions.auth.user, "transport@example.com");
  assert.equal(message.from.name, "Workorder");
  assert.equal(message.from.address, "verified-alias@example.com");
  assert.equal(message.to, "user@example.com");
});
