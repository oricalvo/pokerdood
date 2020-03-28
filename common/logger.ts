export interface Logger {
    debug(...args);
    warn(...args);
    error(...args);
}

export function dumpArray<T>(logger: Logger, message: string, arr: T[]) {
    logger.debug(message);

    if(!arr || !arr.length) {
        logger.debug("NULL or EMPTY");
        return;
    }

    for(const val of arr) {
        logger.debug("    " + val);
    }
}
