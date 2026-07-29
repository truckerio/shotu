import { createSmtpMailer } from "./smtp.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function roleLabel(role) {
  if (role === "office") return "Manager";
  if (role === "surveillance") return "Surveillance";
  if (role === "admin") return "Admin";
  return "Mechanic";
}

function accessLabel(invitation, locationNames) {
  if (invitation.role === "admin") return "all company locations";
  const names = [...new Set((locationNames || []).map((name) => String(name || "").trim()).filter(Boolean))];
  if (!names.length) return "your assigned work location";
  if (names.length === 1) return names[0];
  return names.join(", ");
}

function safeDeliveryError(error) {
  return {
    code: String(error?.code || "SMTP_DELIVERY_FAILED").slice(0, 80),
    name: String(error?.name || "Error").slice(0, 80),
  };
}

export async function sendInvitationEmail({ invitation, inviteUrl, locationNames = [] }, options = {}) {
  const mailer = options.mailer || createSmtpMailer();
  if (!mailer.enabled) return { status: "not_configured" };

  const displayName = String(invitation?.name || "there").trim() || "there";
  const role = roleLabel(invitation?.role);
  const access = accessLabel(invitation || {}, locationNames);
  const safeUrl = escapeHtml(inviteUrl);

  try {
    await mailer.send({
      to: invitation.email,
      subject: "You're invited to Workorder",
      text: [
        `Hi ${displayName},`,
        "",
        `You were invited to join Workorder as ${role} with access to ${access}.`,
        "",
        "Create your account using this secure invitation link:",
        inviteUrl,
        "",
        "This link expires in 7 days and can be used once.",
        "If you were not expecting this invitation, you can ignore this email.",
      ].join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#181d27;max-width:560px">
          <p>Hi ${escapeHtml(displayName)},</p>
          <p>You were invited to join Workorder as <strong>${escapeHtml(role)}</strong> with access to ${escapeHtml(access)}.</p>
          <p>
            <a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#1570ef;color:#fff;text-decoration:none;font-weight:600">
              Create account
            </a>
          </p>
          <p style="color:#667085">This link expires in 7 days and can be used once.</p>
          <p style="color:#667085">If you were not expecting this invitation, you can ignore this email.</p>
        </div>
      `,
    });
    return { status: "sent" };
  } catch (error) {
    (options.onError || ((details) => console.error("Invitation email delivery failed.", details)))(safeDeliveryError(error));
    return { status: "failed" };
  }
}
