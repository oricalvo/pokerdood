export class ServiceToken<T> {
    constructor(public name: string) {
    }
}

const map = new Map<ServiceToken<any>, any>();

export function registerService<T>(token: ServiceToken<T>, service: T) {
    if(!token) {
        throw new Error("Invalid token: " + token);
    }

    map.set(token, service);
}

export function resolveService<T>(token: ServiceToken<T>): T {
    const val = tryResolveService(token);
    if(!val) {
        throw new Error("Service with token " + token.name + " was not found");
    }

    return val;
}

export function tryResolveService<T>(token: ServiceToken<T>): T {
    const val = map.get(token);
    return val;
}
