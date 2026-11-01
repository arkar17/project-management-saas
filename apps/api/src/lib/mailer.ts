import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Adapter boundary: provider is an implementation choice (SRS §10); dev uses a local mail sink. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createSmtpMailer(opts: {
  host: string;
  port: number;
  user?: string | undefined;
  password?: string | undefined;
  from: string;
}): Mailer {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    auth: opts.user ? { user: opts.user, pass: opts.password } : undefined,
  });
  return {
    async send(mail) {
      await transport.sendMail({ from: opts.from, ...mail });
    },
  };
}
