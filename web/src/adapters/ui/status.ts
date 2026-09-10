import type { StatusSink } from '../../app/ports';

// The status line is the studio's only channel to the designer; every outcome, good or bad, ends here.
export class StatusLine implements StatusSink {
  constructor(private readonly element: HTMLElement) {}

  info(message: string): void {
    this.element.textContent = message;
    this.element.style.color = '#8b98a9';
  }

  error(message: string): void {
    this.element.textContent = message;
    this.element.style.color = '#e5766f';
  }
}
