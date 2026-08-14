export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  readonly #instant: Date;

  constructor(instant: Date | string) {
    this.#instant = new Date(instant);
    if (Number.isNaN(this.#instant.getTime())) {
      throw new Error("FixedClock requires a valid instant.");
    }
  }

  now(): Date {
    return new Date(this.#instant);
  }
}
