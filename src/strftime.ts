const formats: Record<string, (date: Date) => string> = {
    //a
    //A
    d: date => String(date.getUTCDate()).padStart(2, '0'),
    e: date => String(date.getUTCDate()).padStart(2, ' '),
    //j: date => String(date.getUTC()),
    u: date => String(date.getUTCDay() || 7),
    w: date => String(date.getUTCDay()),
    //U
    //V
    //W

    // month
    //b
    //B
    //h
    m: date => String(date.getUTCMonth() + 1).padStart(2, '0'),

    // year
    C: date => String(date.getUTCFullYear()).slice(0, -2),
    //g
    //G
    y: date => String(date.getUTCFullYear()).slice(-2, 2),
    Y: date => String(date.getUTCFullYear()),

    // time
    H: date => String(date.getUTCHours()).padStart(2, '0'),
    k: date => String(date.getUTCHours()).padStart(2, ' '),
    //I
    //l
    M: date => String(date.getUTCMinutes()).padStart(2, '0'),
    //p
    //P
    //r
    R: date => `${formats.H(date)}:${formats.M(date)}`,
    S: date => String(date.getUTCSeconds()).padStart(2, '0'),
    T: date => `${formats.H(date)}:${formats.M(date)}:${formats.S(date)}`,
    X: date => `${formats.H(date)}:${formats.M(date)}:${formats.S(date)}`,
    z: () => '+0000',
    Z: () => 'UTC',

    // dates
    // not implemented
};

export default function strftime(date: Date, format: string): string {
    return format.replace(/%(\w)/g, (_, letter) => {
        if (!formats[letter]) {
            throw new Error(`Date letter "%${letter}" in format "${format}" is not supported.`);
        }

        return formats[letter](date);
    });
}
