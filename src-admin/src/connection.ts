/*
 * Minimal connection to the admin websocket (window.io from ../../lib/js/socket.io.js).
 * The tab only needs a few commands - all logic is in the adapter (06 §1).
 */
import type { ObjInfo } from './model';

interface SocketClient {
    on(event: string, cb: (...args: any[]) => void): void;
    emit(name: string, ...args: any[]): void;
    close?(): void;
}

declare global {
    interface Window {
        io?: { connect(url: string, options: Record<string, unknown>): SocketClient };
    }
}

/** Answer of the adapter: `{ ok, data }` or `{ ok: false, error }` */
interface AdapterAnswer<T> {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string };
}

/** Error answer of the adapter */
export class AdapterError extends Error {}

/** Connection to the admin */
export class Connection {
    private socket?: SocketClient;
    private readonly stateHandlers = new Set<(id: string, state: ioBroker.State | null) => void>();
    private connected = false;
    private readonly waiting: (() => void)[] = [];
    public onConnectionChange?: (connected: boolean) => void;

    /** @param instance - adapter instance, e.g. objectmigrator.0 */
    public constructor(public readonly instance: string) {}

    /** Connects; resolves when the server is ready */
    public connect(): Promise<void> {
        if (!window.io) {
            return Promise.reject(new Error('socket.io.js of the admin was not loaded'));
        }
        const url = `${window.location.protocol}//${window.location.host}`;
        this.socket = window.io.connect(url, { name: 'objectmigrator', timeout: 20000 });
        this.socket.on('connect', () => {
            this.connected = true;
            this.onConnectionChange?.(true);
            this.waiting.splice(0).forEach(cb => cb());
        });
        this.socket.on('disconnect', () => {
            this.connected = false;
            this.onConnectionChange?.(false);
        });
        this.socket.on('stateChange', (id: string, state: ioBroker.State | null) => {
            this.stateHandlers.forEach(h => h(id, state));
        });
        return this.ready();
    }

    private ready(): Promise<void> {
        return this.connected ? Promise.resolve() : new Promise(resolve => this.waiting.push(resolve));
    }

    private async call<T>(name: string, ...args: unknown[]): Promise<T> {
        await this.ready();
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timeout: ${name}`)), 15 * 60_000);
            this.socket!.emit(name, ...args, (...result: unknown[]) => {
                clearTimeout(timer);
                resolve(result as T);
            });
        });
    }

    /**
     * Sends a command to the adapter and unpacks the answer
     *
     * @param command - command of main.ts
     * @param message - payload
     */
    public async send<T>(command: string, message: unknown = {}): Promise<T> {
        const [answer] = await this.call<[AdapterAnswer<T>]>('sendTo', this.instance, command, message);
        if (!answer) {
            throw new AdapterError(`${this.instance} does not answer - is the instance running?`);
        }
        if (!answer.ok) {
            throw new AdapterError(answer.error?.message ?? 'unknown error');
        }
        return answer.data as T;
    }

    /**
     * All objects below an ID, including the ID itself
     *
     * @param root - root ID
     */
    public async getSubtree(root: string): Promise<Record<string, ObjInfo>> {
        // without a type js-controller returns only states
        const result: Record<string, ObjInfo> = {};
        for (const type of ['state', 'channel', 'device', 'folder']) {
            const [err, objects] = await this.call<[string | null, Record<string, ObjInfo>]>(
                'getForeignObjects',
                `${root}.*`,
                type,
            );
            if (err) {
                throw new Error(err);
            }
            Object.assign(result, objects ?? {});
        }
        const self = await this.getObject(root);
        if (self) {
            result[root] = self;
        }
        return result;
    }

    /**
     * States below a path (object picker) - an empty path is not allowed (all states of the system)
     *
     * @param path - e.g. `hm-rpc.0`
     */
    public async getStatesBelow(path: string): Promise<Record<string, ObjInfo>> {
        const clean = path.replace(/\.?\*?$/, '');
        if (!clean) {
            return {};
        }
        const [err, objects] = await this.call<[string | null, Record<string, ObjInfo>]>(
            'getForeignObjects',
            `${clean}.*`,
            'state',
        );
        return err ? {} : (objects ?? {});
    }

    /** All rooms and functions (enum.rooms.*, enum.functions.*) */
    public async getEnums(): Promise<Record<string, ObjInfo>> {
        const [err, res] = await this.call<[string | null, { rows: { id: string; value: ObjInfo }[] }]>(
            'getObjectView',
            'system',
            'enum',
            { startkey: 'enum.', endkey: 'enum.香' },
        );
        return err ? {} : Object.fromEntries((res?.rows ?? []).map(r => [r.id, r.value]));
    }

    /** @param id - object ID */
    public async getObject(id: string): Promise<ObjInfo | null> {
        const [err, obj] = await this.call<[string | null, ObjInfo | null]>('getObject', id);
        return err ? null : obj;
    }

    /** All adapter instances */
    public async getInstances(): Promise<Record<string, ObjInfo>> {
        const [err, res] = await this.call<[string | null, { rows: { id: string; value: ObjInfo }[] }]>(
            'getObjectView',
            'system',
            'instance',
            { startkey: 'system.adapter.', endkey: 'system.adapter.香' },
        );
        if (err) {
            throw new Error(err);
        }
        return Object.fromEntries((res?.rows ?? []).map(r => [r.id, r.value]));
    }

    /**
     * Reads a file of the ioBroker file storage as text, null if it does not exist
     *
     * @param adapter - e.g. `history.admin`
     * @param fileName - e.g. `jsonCustom.json`
     */
    public async readFile(adapter: string, fileName: string): Promise<string | null> {
        const [err, data] = await this.call<[string | null, unknown]>('readFile', adapter, fileName);
        if (err || data === null || data === undefined) {
            return null;
        }
        if (typeof data === 'string') {
            return data;
        }
        // a Buffer arrives as { type: 'Buffer', data: [...] }
        const bytes = (data as { data?: number[] }).data;
        return bytes ? new TextDecoder().decode(new Uint8Array(bytes)) : null;
    }

    /** @param pattern - e.g. `lux.0.*` */
    public async getStates(pattern: string): Promise<Record<string, ioBroker.State>> {
        const [err, states] = await this.call<[string | null, Record<string, ioBroker.State>]>('getStates', pattern);
        return err ? {} : (states ?? {});
    }

    /** @param pattern - e.g. `lux.0.*` */
    public subscribe(pattern: string): void {
        void this.ready().then(() => this.socket!.emit('subscribe', pattern));
    }

    /** @param pattern - e.g. `lux.0.*` */
    public unsubscribe(pattern: string): void {
        void this.ready().then(() => this.socket!.emit('unsubscribe', pattern));
    }

    /** @param handler - called for every subscribed state change */
    public onState(handler: (id: string, state: ioBroker.State | null) => void): () => void {
        this.stateHandlers.add(handler);
        return () => this.stateHandlers.delete(handler);
    }
}

/**
 * Parameters the admin passes to the tab: `?0&newReact=true&react=dark` or `?instance=0&…`
 *
 * @param search - view parameters (startkey/endkey)
 */
export function tabParams(search = window.location.search): { instance: number; theme: 'light' | 'dark' } {
    const params = new URLSearchParams(search);
    let instance = Number(params.get('instance'));
    if (!Number.isFinite(instance) || params.get('instance') === null) {
        const bare = [...params.keys()].find(k => /^\d+$/.test(k));
        instance = bare ? Number(bare) : 0;
    }
    const react = params.get('react');
    return { instance, theme: react === 'dark' || react === 'blue' ? 'dark' : 'light' };
}
