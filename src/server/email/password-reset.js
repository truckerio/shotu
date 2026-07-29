import { createSmtpMailer } from "./smtp.js";

const mailer = createSmtpMailer();

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendPasswordResetEmail({ user, url }) {
  const safeUrl = escapeHtml(url);
  const displayName = String(user?.name || "there").trim() || "there";
  await mailer.send({
    to: user.email,
    subject: "Reset your Workorder password",
    text: [
      `Hi ${displayName},`,
      "",
      "Use this secure link to reset your Workorder password:",
      url,
      "",
      "This link expires in 15 minutes and can be used once.",
      "If you did not request this change, you can ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#181d27;max-width:560px">
        <p>Hi ${escapeHtml(displayName)},</p>
        <p>Use the button below to reset your Workorder password.</p>
        <p>
          <a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#1570ef;color:#fff;text-decoration:none;font-weight:600">
            Reset password
          </a>
        </p>
        <p style="color:#667085">This link expires in 15 minutes and can be used once.</p>
        <p style="color:#667085">If you did not request this change, you can ignore this email.</p>
      </div>
    `,
  });
}
