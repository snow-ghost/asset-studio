import type { ConfirmPort } from '../../app/ports';

// The browser's own dialog. It lives here and nowhere else: the app layer asks a question through the port
// and never knows a dialog exists, which is what lets a test answer it with a fake.
export const browserConfirm: ConfirmPort = {
  confirm: (question) => window.confirm(question),
};
