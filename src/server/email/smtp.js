import nodemailer from "nodemailer";

function boolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "ssl"].includes(String(value).trim().toLowerCase());
}

function required(value) {
  return String(value || "").trim();
}

export function resolveSmtpConfig(environment = process.env) {
  const host = required(environment.SMTP_HOST);
  const user = required(environment.SMTP_USER);
  const password = required(environment.SMTP_PASS);
  const fromEmail = required(environment.MAIL_FROM_EMAIL || user);
  const secure = boolean(environment.SMTP_SECURE);
  const port = Number(environment.SMTP_PORT || (secure ? 465 : 587));

  return {
    enabled: Boolean(host && user && password && fromEmail),
    host,
    port: Number.isInteger(port) && port > 0 ? port : (secure ? 465 : 587),
    secure,
    user,
    password,
    fromEmail,
    fromName: required(environment.MAIL_FROM_NAME) || "Workorder",
  };
}

export function createSmtpMailer(config = resolveSmtpConfig(), createTransport = nodemailer.createTransport) {
  let transporter;

  function transport() {
    if (!config.enabled) {
      throw new Error("SMTP password recovery is not configured.");
    }
    transporter ??= createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    return transporter;
  }

  return {
    enabled: config.enabled,
    async send({ to, subject, text, html }) {
      return transport().sendMail({
        from: {
          name: config.fromName,
          address: config.fromEmail,
        },
        to,
        subject,
        text,
        html,
      });
    },
  };
}
