export const LOG_LEVEL = [
    'trace',
    'debug',
    'info',
    'warn',
    'error'
] as const;

export type LogLevel = typeof LOG_LEVEL[number];

export type Logger = {
    [P in LogLevel]: (msg: string, err?: any) => void;
}

export function createConsoleLogger(minLevel: LogLevel): Logger {
    const minLevelIndex = LOG_LEVEL.indexOf(minLevel);
    function log(kind: keyof Logger, ...args: Parameters<Logger['info']>) {
        const level = LOG_LEVEL.indexOf(kind);
        if (level < minLevelIndex) {
            return;
        }

        const now = new Date().toLocaleString();
        const logArgs = [`[${now}][${kind}]${args[0]}`];
        if (args[1]) logArgs.push(args[1]);
        console.log(...logArgs);
    }

    return new Proxy({}, {
        get: function (_, name: LogLevel) {
            return log.bind(null, name);
        }
    }) as Logger;
}
