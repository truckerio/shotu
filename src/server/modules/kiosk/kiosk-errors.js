export class KioskUnlockError extends Error {
  constructor(kind) {
    super(kind === "locked" ? "Kiosk unlock is temporarily locked." : "Invalid kiosk credentials.");
    this.name = "KioskUnlockError";
    this.kind = kind;
  }
}

export class KioskPinChangeRequiredError extends Error {
  constructor() {
    super("A new PIN is required.");
    this.name = "KioskPinChangeRequiredError";
  }
}
