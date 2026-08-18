export type InviteUserActionResult = {
  error?: string;
  ok?: boolean;
  userCreated?: boolean;
  inviteSent?: boolean;
  warning?: string;
};

export type ResendInviteActionResult = {
  error?: string;
  ok?: boolean;
  inviteSent?: boolean;
  passwordReset?: boolean;
};
