import { MailPayload } from './mail.constant';

export function activationMail(
  to: string,
  name: string,
  link: string,
): MailPayload {
  return {
    to,
    subject: 'Kích hoạt tài khoản',
    text: `Xin chào ${name},\n\nBấm vào link sau để kích hoạt tài khoản:\n${link}\n\nLink có hiệu lực trong 24 giờ.`,
    html: `<p>Xin chào <b>${name}</b>,</p>
<p>Bấm vào link sau để kích hoạt tài khoản:</p>
<p><a href="${link}">${link}</a></p>
<p>Link có hiệu lực trong 24 giờ.</p>`,
  };
}

export function resetPasswordMail(
  to: string,
  name: string,
  link: string,
): MailPayload {
  return {
    to,
    subject: 'Đặt lại mật khẩu',
    text: `Xin chào ${name},\n\nBấm vào link sau để đặt lại mật khẩu:\n${link}\n\nLink có hiệu lực trong 1 giờ. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.`,
    html: `<p>Xin chào <b>${name}</b>,</p>
<p>Bấm vào link sau để đặt lại mật khẩu:</p>
<p><a href="${link}">${link}</a></p>
<p>Link có hiệu lực trong 1 giờ. Nếu không phải bạn yêu cầu, hãy bỏ qua email này.</p>`,
  };
}

export function passwordChangedMail(to: string, name: string): MailPayload {
  return {
    to,
    subject: 'Mật khẩu đã được thay đổi',
    text: `Xin chào ${name},\n\nMật khẩu tài khoản của bạn vừa được thay đổi. Nếu không phải bạn thực hiện, hãy liên hệ ngay với chúng tôi.`,
    html: `<p>Xin chào <b>${name}</b>,</p>
<p>Mật khẩu tài khoản của bạn vừa được thay đổi.</p>
<p>Nếu không phải bạn thực hiện, hãy liên hệ ngay với chúng tôi.</p>`,
  };
}
