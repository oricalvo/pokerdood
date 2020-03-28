import * as winston from "winston";
import * as moment from "moment";
import {registerService, resolveService, ServiceToken, tryResolveService} from "oc-tools/serviceLocator";
import * as util from "util";
import * as path from "path";
import {Logger} from "../common/logger";
import * as chalk from "chalk";

const { printf } = winston.format;

const pid = process.pid;

export interface LogMethod {
    (level: string, message: string, meta: any);
}

export function createLogger(name: string): ModuleLogger {
    return new ModuleLogger(name);
}

export function disableLogger(name: string) {
    return new LoggerConfigGuard({
        disabled: [name]
    });
}

export function disableLoggerBut(... names: string[]) {
    return new LoggerConfigGuard({
        enabled: names
    });
}

class MessagePrefixBuilder {
    prefix: string = "";

    constructor() {
    }

    append(str): MessagePrefixBuilder {
        if(!str) {
            return this;
        }

        if(this.prefix) {
            this.prefix += ":";
        }

        this.prefix += str;

        return this;
    }

    done() {
        return this.prefix;
    }
}

function buildFormatMessage(level: string, message: string, meta: MessageMetadata) {
    const prefix = new MessagePrefixBuilder()
        .append(meta.appName)
        .append(meta.pid)
        .append(meta.contextName)
        .append(meta.contextId)
        .append(meta.moduleName)
        .done();

    return `${moment().format("HH:mm:ss:SSS")} ${getLevelString(level)} ${prefix} ${message}`;
}

function addColor(level: string, message: string) {
    if(level == "warn") {
        return chalk.yellowBright(message);
    }
    else if(level == "error") {
        return chalk.red(message);
    }
    else {
        return message;
    }
}

export function createConsoleLogger(appName?: string) {
    const logger = new LoggerService(appName, function(level: string, message: string, meta: any) {
        console.log(addColor(level, buildFormatMessage(level, message, meta)));
    });

    return logger;
}

export function createWinstonLogger(filePath: string,
                                    appName?: string,
                                    consoleTransport: boolean = true,
                                    appendPidToFileName?: boolean): LoggerService {
    if(appendPidToFileName) {
        const info = path.parse(filePath);
        filePath = path.resolve(info.dir, info.name + "_" + process.pid + info.ext);
    }

    const transports: any[] = [
        new winston.transports.File({
            filename: filePath,
            maxsize: 25 * 1024 * 1024,
            maxFiles: 5,
            tailable: true,
            format: printf(info => {
                return buildFormatMessage(info.level, info.message, <any>info);
            })
        })
    ];

    if(consoleTransport) {
        transports.push(new winston.transports.Console({
            format: printf(info => {
                return addColor(info.level, buildFormatMessage(info.level, info.message, <any>info));
            })
        }));
    }

    const logger = winston.createLogger({
        level: "debug",
        transports,
    });

    function logMethod(level: string, message: string, meta: MessageMetadata) {
        logger.log(level, message, meta);
    }

    return new LoggerService(appName, logMethod);
}

export function getLevelString(level: string) {
    return level.toUpperCase();
}

export class NullLogger implements Logger {
    debug(...args) {
    }

    warn(...args) {
    }

    error(...args) {
    }
}

//
//  A wrapper around LogMethod which adds enable/disable functionality
//
export class LoggerService {
    options: LoggerOptions;
    disabledModules = new Set<string>();

    constructor(private appName: string, private logMethod: LogMethod) {
        this.options = {
            verbose: true,
            disabled: null,
            enabled: null,
        }
    }

    log(level: string, message: string, meta: MessageMetadata) {
        const moduleName = meta.moduleName;
        if(moduleName) {
            const disabled = this.options && this.options.disabled;
            if (disabled) {
                if (disabled.indexOf(moduleName) != -1) {
                    return;
                }
            }

            const enabled = this.options && this.options.enabled;
            if (!disabled && enabled) {
                if (enabled.indexOf(moduleName) == -1) {
                    return;
                }
            }
        }

        if(this.appName) {
            meta.appName = this.appName;
        }

        meta.pid = pid;

        this.logMethod(level, message, meta);
    }

    configure(options: LoggerOptions) {
        this.options = options;
    }

    disable(moduleNames: string[]) {
        for(const moduleName of moduleNames) {
            this.disabledModules.add(moduleName);
        }
    }

    isDisabled(moduleName: string) {
        return this.disabledModules.has(moduleName);
    }
}

export interface LoggerOptions {
    enabled?: string[];
    disabled?: string[];
    verbose?: boolean;
}

export class ModuleLogger implements Logger {
    private handle: LoggerServiceHandle;
    private disabled: boolean = false;

    constructor(public name: string) {
    }

    debug(...args) {
        this.log("debug", args);
    }

    warn(...args) {
        this.log("warn", args);
    }

    error(...args) {
        this.log("error", args);
    }

    attachToLoggerService() {
        if(!this.handle) {
            let handle = tryResolveService(LOGGER_HANDLE);
            if(!handle) {
                //
                //  For backward compatibility we support LOGGER without LOGGER_HANDLE
                //  Once all code moves to registerLogger instead of regsiterService there this code can be deleted
                //
                const logger = tryResolveService(LOGGER);
                if(!logger) {
                    this.disabled = true;
                    return;
                }

                handle = {
                    logger,
                }
            }

            if(handle.logger.isDisabled(this.name)) {
                this.disabled = true;
            }

            this.handle = handle;
        }
    }

    private ensureInit() {
        if(!this.handle) {
            this.attachToLoggerService();
        }
    }

    private log(level: string, args) {
        this.ensureInit();

        if(this.disabled) {
            return;
        }

        this.handle.logger.log(level, util.format.apply(undefined, args), {
            moduleName: this.name,
        });
    }
}

export class LoggerConfigGuard {
    logger: LoggerService;
    originalOptions: LoggerOptions;

    constructor(public options: LoggerOptions) {
        this.logger = resolveService(LOGGER);
        if(this.logger) {
            this.originalOptions = this.logger.options;
            this.logger.configure({
                ... this.originalOptions,
                ...options,
            });
        }
    }

    dispose() {
        if(this.logger) {
            this.logger.configure(this.originalOptions);
        }
    }
}

export function isVerboseOn() {
    const logger = resolveService(LOGGER);
    if(!logger) {
        return true;
    }

    return logger.options.verbose;
}

//
//  A handle to the Logger service
//  So application can change service without reseting all module loggers
//
interface LoggerServiceHandle {
    logger: LoggerService;
}

//
//  ModuleLogger holds reference to LOGGER_HANDLE and not LOGGER
//  This way we can replace logger instance during application run and all ModuleLogger use the new one
//
export const LOGGER_HANDLE = new ServiceToken<LoggerServiceHandle>("LOGGER_HANDLE");

export const LOGGER = new ServiceToken<LoggerService>("LOGGER");

export function registerLogger(logger: LoggerService) {
    const handle = tryResolveService(LOGGER_HANDLE);
    if(!handle) {
        registerService(LOGGER_HANDLE, {
            logger,
        });
    }
    else {
        handle.logger = logger;
    }

    registerService(LOGGER, logger);
}

interface MessageMetadata {
    appName?: string;
    pid?: number;
    moduleName?: string;
    contextName?: string;
    contextId?: number;
}
