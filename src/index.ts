import { useMemo, useState, useEffect, useCallback, ChangeEvent } from 'react';

// TODO: Batch upload.
// TODO: Batch abort/remove/clear/retry.
// TODO: Relative paths support.

// region Private types
interface Secret {
    readonly flushed: boolean;
    readonly total: number;
    readonly loaded: number;
    readonly xhr: XMLHttpRequest | null;
    readonly onprogress: { (event: ProgressEvent): void } | null;
    readonly onload: { (): void } | null;
    readonly onerror: { (): void } | null;
    readonly onabort: { (): void } | null;
}

interface Private {
    items: readonly Uq.Item[];

    readonly secrets: WeakMap<Uq.Item, Secret>;
    readonly url: string;
    readonly field: string;
    readonly concurrency: number;
}
// endregion Private types

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
const map = (uq: Uq, f: (item: Uq.Item, secret: Secret) => readonly [Uq.Item, Secret]) => {
    const __ = _.get(uq)!;

    __.items = __.items.map(item => {
        const secret = __.secrets.get(item)!;

        const [updatedItem, updatedSecret] = f(item, secret);

        __.secrets.set(updatedItem, updatedSecret);

        return updatedItem;
    });
};

const update = (uq: Uq, id: number, f: (item: Uq.Item, secret: Secret) => readonly [Uq.Item, Secret]) => {
    map(uq, (item, secret) => (item.id === id ? f(item, secret) : [item, secret]));
};

const find = (uq: Uq, id: number): Uq.Item => {
    return _.get(uq)!.items.find(item => item.id === id)!;
};

const filterUnfinished = (item: Uq.Item) => item.status & Uq.Status.Unfinished;
const filterPending = (item: Uq.Item) => item.status === Uq.Status.Pending;
// endregion Private list operations

// region Private logic
const triggerChange = (uq: Uq) => {
    const __ = _.get(uq)!;

    const unflushed = __.items.filter(item => !__.secrets.get(item)!.flushed);
    const active = Boolean(unflushed.length);

    const [total, loaded] = unflushed.reduce(
        ([total, loaded], item) => {
            const secret = __.secrets.get(item)!;

            return [total + secret.total, loaded + secret.loaded];
        },
        [0, 0] as readonly [number, number],
    );

    const progress = calculateProgress(total, loaded);

    uq.dispatchEvent(new Uq.ChangeEvent(__.items, progress, active));
};

const tick = (uq: Uq) => {
    const __ = _.get(uq)!;

    __.items
        .filter(filterUnfinished)
        .slice(0, __.concurrency)
        .filter(filterPending)
        .forEach(item => send(uq, item));
};

const send = (uq: Uq, item: Uq.Item) => {
    const { id, file } = item;
    const __ = _.get(uq)!;

    // Prepare the XHR:
    const xhr = new XMLHttpRequest();

    xhr.open('POST', __.url);

    xhr.responseType = 'arraybuffer';

    // Set up event handlers:
    const onprogress = ({ total, loaded }: ProgressEvent) => {
        const progress = calculateProgress(total, loaded);

        update(uq, id, (item, secret) => [
            { ...item, progress },
            { ...secret, total, loaded },
        ]);

        triggerChange(uq);
        uq.dispatchEvent(new Uq.ProgressEvent(find(uq, id)));
    };

    const onfinish = (status: Uq.Status) => {
        xhr.upload.removeEventListener('progress', onprogress);
        xhr.removeEventListener('load', onload);
        xhr.removeEventListener('error', onerror);
        xhr.removeEventListener('abort', onabort);

        // Update status and flush state:
        const unfinished = __.items.filter(filterUnfinished);
        const flushed = unfinished.length <= 1;

        map(uq, (item, secret) => {
            if (item.id !== id) {
                if (flushed && !secret.flushed) {
                    return [item, { ...secret, flushed }];
                } else {
                    return [item, secret];
                }
            } else {
                return [
                    {
                        ...item,
                        status,
                    },
                    {
                        ...secret,
                        flushed: Boolean(status & Uq.Status.Failed) || flushed,
                        xhr: null,
                        onprogress: null,
                        onload: null,
                        onerror: null,
                        onabort: null,
                    },
                ];
            }
        });

        // Trigger events:
        triggerChange(uq);

        const item = find(uq, id);

        if (status === Uq.Status.Done) {
            uq.dispatchEvent(
                new Uq.DoneEvent(
                    item,
                    new Response(xhr.response, {
                        status: xhr.status,
                        statusText: xhr.statusText,
                        headers: parseHeaders(xhr),
                    }),
                ),
            );
        } else if (status === Uq.Status.Error) {
            uq.dispatchEvent(new Uq.ErrorEvent(item));
        } else {
            uq.dispatchEvent(new Uq.AbortEvent(item));
        }

        uq.dispatchEvent(new Uq.FinishEvent(item));

        // Trigger iteration:
        tick(uq);
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

    body.append(__.field, file);

    xhr.send(body);

    // Update item status and private properties:
    update(uq, id, (item, secret) => [
        {
            ...item,
            status: Uq.Status.Ongoing,
        },
        {
            ...secret,
            xhr,
            onprogress,
            onload,
            onerror,
            onabort,
        },
    ]);

    // Trigger the `change` event:
    triggerChange(uq);
};
// endregion Private logic

const _ = new WeakMap<Uq, Private>();

/**
 * File upload queue on steroids.
 */
export class Uq extends EventTarget {
    constructor(url: string, field = 'file', concurrency = 4) {
        super();

        _.set(this, {
            items: [],
            secrets: new WeakMap(),
            url,
            field,
            concurrency,
        });
    }

    /**
     * Adds items to the queue.
     *
     * @param files Item or items to add.
     */
    push(files?: File | Iterable<File> | null) {
        if (!files) return;

        const __ = _.get(this)!;

        files = files instanceof File ? [files] : files;

        __.items = __.items.concat(
            Array.from(files, file => {
                const item: Uq.Item = {
                    id: Math.random(),
                    file,
                    status: Uq.Status.Pending,
                    progress: 0,
                };

                __.secrets.set(item, {
                    flushed: false,
                    total: file.size,
                    loaded: 0,
                    xhr: null,
                    onprogress: null,
                    onload: null,
                    onerror: null,
                    onabort: null,
                });

                return item;
            }),
        );

        triggerChange(this);
        tick(this);
    }

    /**
     * Aborts item uploading without removeing from the queue. Implicitly triggers the `abort` event.
     *
     * @param item Item or item identifer to abort.
     */
    abort(item?: number | Uq.Item | undefined) {
        if (item == null) return;

        item = find(this, typeof item === 'number' ? item : item.id);

        if (!item) return;

        const __ = _.get(this)!;
        const secret = __.secrets.get(item)!;

        if (!secret.xhr) {
            if (item.status === Uq.Status.Pending) {
                update(this, item.id, (item, secret) => [{ ...item, status: Uq.Status.Aborted }, secret]);
            }
        } else {
            secret.xhr.abort();
        }

        triggerChange(this);
        tick(this);
    }

    /**
     * Unlike {@link Uq.abort}, removes an item silently, without triggering the `abort` event.
     *
     * @param item  Item or item identifer to silently remove from the queue.
     */
    remove(item?: number | Uq.Item | undefined) {
        if (item == null) return;

        item = find(this, typeof item === 'number' ? item : item.id);

        if (!item) return;

        const __ = _.get(this)!;
        const secret = __.secrets.get(item)!;

        if (secret.xhr) {
            secret.xhr.upload.removeEventListener('progress', secret.onprogress!);
            secret.xhr.removeEventListener('load', secret.onload!);
            secret.xhr.removeEventListener('error', secret.onerror!);
            secret.xhr.removeEventListener('abort', secret.onabort!);

            secret.xhr.abort();
        }

        const { id } = item;

        __.items = __.items.filter(item => item.id !== id);

        triggerChange(this);
        tick(this);
    }

    /**
     * Retries uploading of failed item.
     *
     * @param item Item or item identifer to retry.
     */
    retry(item?: number | Uq.Item | undefined) {
        if (item == null) return;

        item = find(this, typeof item === 'number' ? item : item.id);

        if (!item) return;
        if (!(item.status & Uq.Status.Failed)) return;

        update(this, item.id, (item, secret) => [{ ...item, status: Uq.Status.Pending }, secret]);

        triggerChange(this);
        tick(this);
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
    }

    /**
     * Upload queue change event. Triggers at each change of any internal value.
     */
    export class ChangeEvent extends Event {
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
    export class ProgressEvent extends Event {
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
    export class DoneEvent extends Event {
        /**
         * An item just completed.
         */
        readonly item: Uq.Item;

        /**
         * Server response object.
         */
        readonly response: Response;

        constructor(item: Uq.Item, response: Response) {
            super('done');

            this.item = item;
            this.response = response;
        }
    }

    /**
     * Upload item error event. Triggers on network errors etc.
     */
    export class ErrorEvent extends Event {
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
    export class AbortEvent extends Event {
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
    export class FinishEvent extends Event {
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
        readonly change: Uq.ChangeEvent;
        readonly progress: Uq.ProgressEvent;
        readonly done: Uq.DoneEvent;
        readonly error: Uq.ErrorEvent;
        readonly abort: Uq.AbortEvent;
        readonly finish: Uq.FinishEvent;
    }
}

export function useUq(url: string, field = 'file', concurrency = 4) {
    const uq = useMemo(() => new Uq(url, field, concurrency), [url, field, concurrency]);

    const [items, setItems] = useState<readonly Uq.Item[]>([]);
    const [progress, setProgress] = useState(0);
    const [active, setActive] = useState(false);

    useEffect(() => {
        const handleChange = ({ items, progress, active }: Uq.ChangeEvent) => {
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

export function useFileChangeHandler(uq: Uq) {
    return useCallback(
        (event: ChangeEvent) => {
            const input = event.target as HTMLInputElement;

            uq.push(input.files);
        },
        [uq],
    );
};
