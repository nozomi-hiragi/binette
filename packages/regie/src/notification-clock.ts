/** Owns the minute tick and the single current-session notification popup. */
export class NotificationClock {
  private minuteTimer: ReturnType<typeof setTimeout> | undefined;
  private popupTimer: ReturnType<typeof setTimeout> | undefined;
  private popupId: number | undefined;
  private urgent = false;
  private kept = false;

  constructor(
    private readonly changed: () => void,
    private readonly now: () => number = Date.now,
    private readonly later: typeof setTimeout = setTimeout,
    private readonly cancel: typeof clearTimeout = clearTimeout,
  ) {
    this.scheduleMinute();
  }

  private scheduleMinute(): void {
    this.minuteTimer = this.later(() => {
      this.changed();
      this.scheduleMinute();
    }, 60_000 - (this.now() % 60_000 + 60_000) % 60_000);
  }

  private schedulePopup(): void {
    this.cancel(this.popupTimer);
    this.popupTimer = undefined;
    if (this.popupId === undefined || this.urgent || this.kept) return;
    this.popupTimer = this.later(() => {
      this.popupId = undefined;
      this.popupTimer = undefined;
      this.changed();
    }, 5_000);
  }

  arrive(id: number, urgent: boolean): void {
    this.popupId = id;
    this.urgent = urgent;
    this.kept = false;
    this.schedulePopup();
  }

  keep(id: number, keep: boolean): void {
    if (this.popupId !== id || this.kept === keep) return;
    this.kept = keep;
    this.schedulePopup();
  }

  remove(id: number): void {
    if (this.popupId !== id) return;
    this.cancel(this.popupTimer);
    this.popupTimer = undefined;
    this.popupId = undefined;
    this.kept = false;
  }

  isPopup(id: number): boolean { return this.popupId === id; }

  stop(): void {
    this.cancel(this.minuteTimer);
    this.cancel(this.popupTimer);
    this.popupId = undefined;
  }
}
