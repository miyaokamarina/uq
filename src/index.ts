import { useMemo, useState, useEffect } from 'react';

// TODO: Batch upload.
// TODO: Batch abort/remove/clear/retry.
// TODO: Relative paths support.

// region Private helpers
const parseHeader = (src: string) => {
    const match = /^(.*):\s*(.*?)\s*$/.exec(src);

    if (!match) return null!;

    const [, k, v] = match;

    return [k, v];
};

const parseHeaders = (xhr: XMLHttpRequest) => {
    return new Headers(
        xhr
            .getAllResponseHeaders()
            .trim()
            .split(/[\r\n]+/)
            .map(parseHeader)
            .filter(Boolean),
    );
};

const calculateProgress = (total: number, loaded: number): number => {
    if (!total) return 1;

    const raw = Math.round((loaded / total) * 1000) / 1000;

    if (Number.isNaN(raw)) return 0;

    return Math.max(0, Math.min(raw, 1));
};
// endregion Private helpers

// region Private list operations
const filterUnfinished = (item: Uq.Item) => item.status & Uq.Status.Unfinished;
const filterPending = (item: Uq.Item) => item.status === Uq.Status.Pending;
// endregion Private list operations

/**
 * File upload queue on steroids.
 */
export class Uq<r = Response> extends EventTarget {
    private items: readonly Uq.Item[] = [];

    private readonly field: string;
    private readonly concurrency: number;
    private readonly onResponse?: (_: Response) => readonly [Uq.Status.Done, r] | readonly [Uq.Status.Error, unknown?];

    constructor(options = {} as Uq.Options<r>) {
        super();

        const { field = 'file', concurrency = 4, onResponse } = options;

        this.field = field;
        this.concurrency = concurrency;
        this.onResponse = onResponse;
    }

    /**
     * Adds items to the queue.
     *
     * @param files Item or items to add.
     */
    push(file: File, url: string) {
        this.items = this.items.concat({
            id: Math.random(),
            file,
            status: Uq.Status.Pending,
            progress: 0,
            url,

            flushed: false,
            total: file.size,
            loaded: 0,
            xhr: null,
            onprogress: null,
            onload: null,
            onerror: null,
            onabort: null,
        });

        this.triggerChange();
        this.tick();
    }

    /**
     * Aborts item uploading without removeing from the queue. Implicitly triggers the `abort` event.
     *
     * @param id An identifier of the item to abort.
     */
    abort(id: number) {
        const item = this.find(id);

        if (!item) return;

        if (item.xhr) {
            item.xhr.abort();
        } else if (item.status === Uq.Status.Pending) {
            this.update(item.id, item => ({ ...item, status: Uq.Status.Aborted }));
        }

        this.triggerChange();
        this.tick();
    }

    /**
     * Unlike {@link Uq.abort}, removes an item silently, without triggering the `abort` event.
     *
     * @param id An identifier of the item to silently remove from the queue.
     */
    remove(id: number) {
        const item = this.find(id);

        if (!item) return;

        if (item.xhr) {
            item.xhr.upload.removeEventListener('progress', item.onprogress!);
            item.xhr.removeEventListener('load', item.onload!);
            item.xhr.removeEventListener('error', item.onerror!);
            item.xhr.removeEventListener('abort', item.onabort!);

            item.xhr.abort();
        }

        this.items = this.items.filter(item => item.id !== id);

        this.triggerChange();
        this.tick();
    }

    /**
     * Retries uploading of failed item.
     *
     * @param id An identifier of the item to retry.
     */
    retry(id: number) {
        const item = this.find(id);

        if (!item || !(item.status & Uq.Status.Failed)) return;

        this.update(id, item => ({ ...item, status: Uq.Status.Pending, flushed: false }));

        this.triggerChange();
        this.tick();
    }

    private find(id: number): Uq.Item | undefined {
        return this.items.find(item => item.id === id);
    }

    private map(map: (item: Uq.Item) => Uq.Item) {
        this.items = this.items.map(map);
    }

    private update(id: number, map: (item: Uq.Item) => Uq.Item) {
        this.map(item => (item.id === id ? map(item) : item));
    }

    private triggerChange() {
        const unflushed = this.items.filter(item => !item.flushed);
        const active = Boolean(unflushed.length);

        const [total, loaded] = unflushed.reduce(([total, loaded], item) => [total + item.total, loaded + item.loaded], [0, 0] as readonly [number, number]);

        const progress = calculateProgress(total, loaded);

        this.dispatchEvent(new Uq.UqChangeEvent(this.items, progress, active));
    }

    private tick() {
        this.items
            .filter(filterUnfinished)
            .slice(0, this.concurrency)
            .filter(filterPending)
            .forEach(item => this.send(item));
    }

    private send(item: Uq.Item) {
        const { id, file, url } = item;

        // Prepare the XHR:
        const xhr = new XMLHttpRequest();

        xhr.open('POST', url);

        xhr.responseType = 'arraybuffer';

        // Set up event handlers:
        const onprogress = ({ total, loaded }: ProgressEvent) => {
            const progress = calculateProgress(total, loaded);

            this.update(id, item => ({
                ...item,
                progress,
                total,
                loaded,
            }));

            this.triggerChange();
            this.dispatchEvent(new Uq.UqProgressEvent(this.find(id)!));
        };

        const onfinish = (status: Uq.Status) => {
            xhr.upload.removeEventListener('progress', onprogress);
            xhr.removeEventListener('load', onload);
            xhr.removeEventListener('error', onerror);
            xhr.removeEventListener('abort', onabort);

            // Update status and flush state:
            const unfinished = this.items.filter(filterUnfinished);
            const flushed = unfinished.length <= 1;

            let response: Response;

            if (status === Uq.Status.Done && this.onResponse) {
                response = new Response(xhr.response, {
                    status: xhr.status,
                    statusText: xhr.statusText,
                    headers: parseHeaders(xhr),
                });

                const processed = this.onResponse(response);

                if (processed[0] === Uq.Status.Error) {
                    status = Uq.Status.Error;
                } else {
                    response = processed[1] as any;
                }
            }

            this.map(item => {
                if (item.id !== id) {
                    if (flushed && !item.flushed) {
                        return { ...item, flushed };
                    } else {
                        return item;
                    }
                } else {
                    return {
                        ...item,
                        status,
                        flushed: Boolean(status & Uq.Status.Failed) || flushed,
                        xhr: null,
                        onprogress: null,
                        onload: null,
                        onerror: null,
                        onabort: null,
                    };
                }
            });

            // Trigger events:
            this.triggerChange();

            const item = this.find(id)!;

            if (status === Uq.Status.Done) {
                this.dispatchEvent(new Uq.UqDoneEvent(item, response!));
            } else if (status === Uq.Status.Error) {
                this.dispatchEvent(new Uq.UqErrorEvent(item));
            } else {
                this.dispatchEvent(new Uq.UqAbortEvent(item));
            }

            this.dispatchEvent(new Uq.UqFinishEvent(item));

            // Trigger iteration:
            this.tick();
        };

        const onload = () => {
            onfinish(Uq.Status.Done);
        };

        const onerror = () => {
            onfinish(Uq.Status.Error);
        };

        const onabort = () => {
            onfinish(Uq.Status.Aborted);
        };

        xhr.upload.addEventListener('progress', onprogress);
        xhr.addEventListener('load', onload);
        xhr.addEventListener('error', onerror);
        xhr.addEventListener('abort', onabort);

        // Build and send form data:
        const body = new FormData();

        body.append(this.field, file);

        xhr.send(body);

        // Update item status and private properties:
        this.update(id, item => ({
            ...item,
            status: Uq.Status.Ongoing,
            xhr,
            onprogress,
            onload,
            onerror,
            onabort,
        }));

        // Trigger the `change` event:
        this.triggerChange();
    }

    addEventListener<t extends keyof Uq.EventMap>(t: t, h: (this: Uq, _: Uq.EventMap[t]) => any, o?: boolean | AddEventListenerOptions): void;
    addEventListener(t: string, h: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions): void;
    addEventListener(t: string, h: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions): void {
        super.addEventListener(t, h, o);
    }

    removeEventListener<t extends keyof Uq.EventMap>(t: t, h: (this: Uq, _: Uq.EventMap[t]) => any, o?: boolean | AddEventListenerOptions): void;
    removeEventListener(t: string, h: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions): void;
    removeEventListener(t: string, h: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions): void {
        super.removeEventListener(t, h, o);
    }
}

export namespace Uq {
    /**
     * Upload queue item status code.
     */
    export enum Status {
        Pending /*    */ = 0b000_01,
        Ongoing /*    */ = 0b000_10,
        Unfinished /* */ = 0b000_11,

        Done /*       */ = 0b001_00,
        Error /*      */ = 0b010_00,
        Aborted /*    */ = 0b100_00,
        Failed /*     */ = 0b110_00,
        Finished /*   */ = 0b111_00,
    }

    /**
     * Upload queue item.
     */
    export interface Item {
        /**
         * Random unique identifier.
         */
        readonly id: number;

        /**
         * File object to upload.
         */
        readonly file: File;

        /**
         * Current status.
         */
        readonly status: Uq.Status;

        /**
         * Current progress.
         */
        readonly progress: number;

        /**
         * Target URL.
         */
        readonly url: string;

        readonly flushed: boolean;
        readonly total: number;
        readonly loaded: number;
        readonly xhr: XMLHttpRequest | null;
        readonly onprogress: { (event: ProgressEvent): void } | null;
        readonly onload: { (): void } | null;
        readonly onerror: { (): void } | null;
        readonly onabort: { (): void } | null;
    }

    /**
     * Upload queue change event. Triggers at each change of any internal value.
     */
    export class UqChangeEvent extends Event {
        /**
         * Current upload items list.
         */
        readonly items: readonly Uq.Item[];

        /**
         * Current total progress.
         */
        readonly progress: number;

        /**
         * Current ongoing status; i.e., `true` if there is at least one ongoing upload, `false` otherwise.
         */
        readonly active: boolean;

        constructor(items: readonly Uq.Item[], progress: number, active: boolean) {
            super('change');

            this.items = items;
            this.progress = progress;
            this.active = active;
        }
    }

    /**
     * Upload item progress event.
     */
    export class UqProgressEvent extends Event {
        /**
         * An item just progressed.
         */
        readonly item: Uq.Item;

        constructor(item: Uq.Item) {
            super('progress');

            this.item = item;
        }
    }

    /**
     * Upload item success event.
     */
    export class UqDoneEvent<r = Response> extends Event {
        /**
         * An item just completed.
         */
        readonly item: Uq.Item;

        /**
         * Server response object.
         */
        readonly response: r;

        constructor(item: Uq.Item, response: r) {
            super('done');

            this.item = item;
            this.response = response;
        }
    }

    /**
     * Upload item error event. Triggers on network errors etc.
     */
    export class UqErrorEvent extends Event {
        /**
         * An item just errored.
         */
        readonly item: Uq.Item;

        constructor(item: Uq.Item) {
            super('error');

            this.item = item;
        }
    }

    /**
     * Upload item abort event. Triggers when user aborts upload.
     */
    export class UqAbortEvent extends Event {
        /**
         * An item just aborted.
         */
        readonly item: Uq.Item;

        constructor(item: Uq.Item) {
            super('abort');

            this.item = item;
        }
    }

    /**
     * Upload item finish event. Trigger after `done`, `error`, `abort`.
     */
    export class UqFinishEvent extends Event {
        /**
         * An item just finished.
         */
        readonly item: Uq.Item;

        constructor(item: Uq.Item) {
            super('finish');

            this.item = item;
        }
    }

    export interface EventMap {
        readonly change: Uq.UqChangeEvent;
        readonly progress: Uq.UqProgressEvent;
        readonly done: Uq.UqDoneEvent;
        readonly error: Uq.UqErrorEvent;
        readonly abort: Uq.UqAbortEvent;
        readonly finish: Uq.UqFinishEvent;
    }

    /**
     * Uq options insterface.
     */
    export interface Options<r = Response> {
        /**
         * Upload `FormData` field name. Defaults to `'file'`.
         */
        readonly field?: string;

        /**
         * Maximum number of simultaneous uploads. Defaults to `4`.
         */
        readonly concurrency?: number;

        /**
         * Response handler allowing to transform erroneous “successful” result into errors.
         */
        readonly onResponse?: (_: Response) => readonly [Uq.Status.Done, r] | readonly [Uq.Status.Error, unknown?];
    }
}

/**
 * Takes UQ options, returns a tuple of current state values (`items`, `progress`, `active`) and the UQ instance.
 */
export function useUq<r = Response>(options = {} as Uq.Options<r>) {
    const { field, concurrency, onResponse } = options;

    const uq = useMemo(() => new Uq({ field, concurrency, onResponse }), [field, concurrency, onResponse]);

    const [items, setItems] = useState<readonly Uq.Item[]>([]);
    const [progress, setProgress] = useState(0);
    const [active, setActive] = useState(false);

    useEffect(() => {
        if (!uq) return;

        const handleChange = ({ items, progress, active }: Uq.UqChangeEvent) => {
            setItems(items);
            setProgress(progress);
            setActive(active);
        };

        uq.addEventListener('change', handleChange);

        return () => {
            uq.removeEventListener('change', handleChange);
        };
    }, [uq]);

    return [items, progress, active, uq] as const;
}
