"use strict";
var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
exports.__esModule = true;
exports.useUq = exports.Uq = void 0;
var react_1 = require("react");
// endregion Private types
// region Private helpers
var parseHeader = function (src) {
    var match = /^(.*):\s*(.*?)\s*$/.exec(src);
    if (!match)
        return null;
    var k = match[1], v = match[2];
    return [k, v];
};
var parseHeaders = function (xhr) {
    return new Headers(xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)
        .map(parseHeader)
        .filter(Boolean));
};
var calculateProgress = function (total, loaded) {
    if (!total)
        return 1;
    var raw = Math.round((loaded / total) * 1000) / 1000;
    if (Number.isNaN(raw))
        return 0;
    return Math.max(0, Math.min(raw, 1));
};
// endregion Private helpers
// region Private list operations
var map = function (uq, f) {
    var __ = _.get(uq);
    __.items = __.items.map(function (item) {
        var secret = __.secrets.get(item);
        var _a = f(item, secret), updatedItem = _a[0], updatedSecret = _a[1];
        __.secrets.set(updatedItem, updatedSecret);
        return updatedItem;
    });
};
var update = function (uq, id, f) {
    map(uq, function (item, secret) { return (item.id === id ? f(item, secret) : [item, secret]); });
};
var find = function (uq, id) {
    return _.get(uq).items.find(function (item) { return item.id === id; });
};
var filterUnfinished = function (item) { return item.status & Uq.Status.Unfinished; };
var filterPending = function (item) { return item.status === Uq.Status.Pending; };
// endregion Private list operations
// region Private logic
var triggerChange = function (uq) {
    var __ = _.get(uq);
    var unflushed = __.items.filter(function (item) { return !__.secrets.get(item).flushed; });
    var active = Boolean(unflushed.length);
    var _a = unflushed.reduce(function (_a, item) {
        var total = _a[0], loaded = _a[1];
        var secret = __.secrets.get(item);
        return [total + secret.total, loaded + secret.loaded];
    }, [0, 0]), total = _a[0], loaded = _a[1];
    var progress = calculateProgress(total, loaded);
    uq.dispatchEvent(new Uq.ChangeEvent(__.items, progress, active));
};
var tick = function (uq) {
    var __ = _.get(uq);
    __.items
        .filter(filterUnfinished)
        .slice(0, __.concurrency)
        .filter(filterPending)
        .forEach(function (item) { return send(uq, item); });
};
var send = function (uq, item) {
    var id = item.id, file = item.file;
    var __ = _.get(uq);
    // Prepare the XHR:
    var xhr = new XMLHttpRequest();
    xhr.open('POST', __.url);
    xhr.responseType = 'arraybuffer';
    // Set up event handlers:
    var onprogress = function (_a) {
        var total = _a.total, loaded = _a.loaded;
        var progress = calculateProgress(total, loaded);
        update(uq, id, function (item, secret) { return [
            __assign(__assign({}, item), { progress: progress }),
            __assign(__assign({}, secret), { total: total, loaded: loaded }),
        ]; });
        triggerChange(uq);
        uq.dispatchEvent(new Uq.ProgressEvent(find(uq, id)));
    };
    var onfinish = function (status) {
        xhr.upload.removeEventListener('progress', onprogress);
        xhr.removeEventListener('load', onload);
        xhr.removeEventListener('error', onerror);
        xhr.removeEventListener('abort', onabort);
        // Update status and flush state:
        var unfinished = __.items.filter(filterUnfinished);
        var flushed = unfinished.length <= 1;
        map(uq, function (item, secret) {
            if (item.id !== id) {
                if (flushed && !secret.flushed) {
                    return [item, __assign(__assign({}, secret), { flushed: flushed })];
                }
                else {
                    return [item, secret];
                }
            }
            else {
                return [
                    __assign(__assign({}, item), { status: status }),
                    __assign(__assign({}, secret), { flushed: Boolean(status & Uq.Status.Failed) || flushed, xhr: null, onprogress: null, onload: null, onerror: null, onabort: null }),
                ];
            }
        });
        // Trigger events:
        triggerChange(uq);
        var item = find(uq, id);
        if (status === Uq.Status.Done) {
            uq.dispatchEvent(new Uq.DoneEvent(item, new Response(xhr.response, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: parseHeaders(xhr)
            })));
        }
        else if (status === Uq.Status.Error) {
            uq.dispatchEvent(new Uq.ErrorEvent(item));
        }
        else {
            uq.dispatchEvent(new Uq.AbortEvent(item));
        }
        uq.dispatchEvent(new Uq.FinishEvent(item));
        // Trigger iteration:
        tick(uq);
    };
    var onload = function () {
        onfinish(Uq.Status.Done);
    };
    var onerror = function () {
        onfinish(Uq.Status.Error);
    };
    var onabort = function () {
        onfinish(Uq.Status.Aborted);
    };
    xhr.upload.addEventListener('progress', onprogress);
    xhr.addEventListener('load', onload);
    xhr.addEventListener('error', onerror);
    xhr.addEventListener('abort', onabort);
    // Build and send form data:
    var body = new FormData();
    body.append(__.field, file);
    xhr.send(body);
    // Update item status and private properties:
    update(uq, id, function (item, secret) { return [
        __assign(__assign({}, item), { status: Uq.Status.Ongoing }),
        __assign(__assign({}, secret), { xhr: xhr,
            onprogress: onprogress,
            onload: onload,
            onerror: onerror,
            onabort: onabort }),
    ]; });
    // Trigger the `change` event:
    triggerChange(uq);
};
// endregion Private logic
var _ = new WeakMap();
/**
 * File upload queue on steroids.
 */
var Uq = /** @class */ (function (_super) {
    __extends(Uq, _super);
    function Uq(url, options) {
        if (options === void 0) { options = {}; }
        var _this = _super.call(this) || this;
        var _a = options.field, field = _a === void 0 ? 'file' : _a, _b = options.concurrency, concurrency = _b === void 0 ? 4 : _b;
        _.set(_this, {
            items: [],
            secrets: new WeakMap(),
            url: url,
            field: field,
            concurrency: concurrency
        });
        return _this;
    }
    /**
     * Adds items to the queue.
     *
     * @param files Item or items to add.
     */
    Uq.prototype.push = function (files) {
        if (!files)
            return;
        var __ = _.get(this);
        files = files instanceof File ? [files] : files;
        __.items = __.items.concat(Array.from(files, function (file) {
            var item = {
                id: Math.random(),
                file: file,
                status: Uq.Status.Pending,
                progress: 0
            };
            __.secrets.set(item, {
                flushed: false,
                total: file.size,
                loaded: 0,
                xhr: null,
                onprogress: null,
                onload: null,
                onerror: null,
                onabort: null
            });
            return item;
        }));
        triggerChange(this);
        tick(this);
    };
    /**
     * Aborts item uploading without removeing from the queue. Implicitly triggers the `abort` event.
     *
     * @param item Item or item identifer to abort.
     */
    Uq.prototype.abort = function (item) {
        if (item == null)
            return;
        item = find(this, typeof item === 'number' ? item : item.id);
        if (!item)
            return;
        var __ = _.get(this);
        var secret = __.secrets.get(item);
        if (!secret.xhr) {
            if (item.status === Uq.Status.Pending) {
                update(this, item.id, function (item, secret) { return [__assign(__assign({}, item), { status: Uq.Status.Aborted }), secret]; });
            }
        }
        else {
            secret.xhr.abort();
        }
        triggerChange(this);
        tick(this);
    };
    /**
     * Unlike {@link Uq.abort}, removes an item silently, without triggering the `abort` event.
     *
     * @param item  Item or item identifer to silently remove from the queue.
     */
    Uq.prototype.remove = function (item) {
        if (item == null)
            return;
        item = find(this, typeof item === 'number' ? item : item.id);
        if (!item)
            return;
        var __ = _.get(this);
        var secret = __.secrets.get(item);
        if (secret.xhr) {
            secret.xhr.upload.removeEventListener('progress', secret.onprogress);
            secret.xhr.removeEventListener('load', secret.onload);
            secret.xhr.removeEventListener('error', secret.onerror);
            secret.xhr.removeEventListener('abort', secret.onabort);
            secret.xhr.abort();
        }
        var id = item.id;
        __.items = __.items.filter(function (item) { return item.id !== id; });
        triggerChange(this);
        tick(this);
    };
    /**
     * Retries uploading of failed item.
     *
     * @param item Item or item identifer to retry.
     */
    Uq.prototype.retry = function (item) {
        if (item == null)
            return;
        item = find(this, typeof item === 'number' ? item : item.id);
        if (!item)
            return;
        if (!(item.status & Uq.Status.Failed))
            return;
        update(this, item.id, function (item, secret) { return [__assign(__assign({}, item), { status: Uq.Status.Pending }), secret]; });
        triggerChange(this);
        tick(this);
    };
    Uq.prototype.addEventListener = function (t, h, o) {
        _super.prototype.addEventListener.call(this, t, h, o);
    };
    Uq.prototype.removeEventListener = function (t, h, o) {
        _super.prototype.removeEventListener.call(this, t, h, o);
    };
    return Uq;
}(EventTarget));
exports.Uq = Uq;
(function (Uq) {
    /**
     * Upload queue item status code.
     */
    var Status;
    (function (Status) {
        Status[Status["Pending"] = 1] = "Pending";
        Status[Status["Ongoing"] = 2] = "Ongoing";
        Status[Status["Unfinished"] = 3] = "Unfinished";
        Status[Status["Done"] = 4] = "Done";
        Status[Status["Error"] = 8] = "Error";
        Status[Status["Aborted"] = 16] = "Aborted";
        Status[Status["Failed"] = 24] = "Failed";
        Status[Status["Finished"] = 28] = "Finished";
    })(Status = Uq.Status || (Uq.Status = {}));
    /**
     * Upload queue change event. Triggers at each change of any internal value.
     */
    var ChangeEvent = /** @class */ (function (_super) {
        __extends(ChangeEvent, _super);
        function ChangeEvent(items, progress, active) {
            var _this = _super.call(this, 'change') || this;
            _this.items = items;
            _this.progress = progress;
            _this.active = active;
            return _this;
        }
        return ChangeEvent;
    }(Event));
    Uq.ChangeEvent = ChangeEvent;
    /**
     * Upload item progress event.
     */
    var ProgressEvent = /** @class */ (function (_super) {
        __extends(ProgressEvent, _super);
        function ProgressEvent(item) {
            var _this = _super.call(this, 'progress') || this;
            _this.item = item;
            return _this;
        }
        return ProgressEvent;
    }(Event));
    Uq.ProgressEvent = ProgressEvent;
    /**
     * Upload item success event.
     */
    var DoneEvent = /** @class */ (function (_super) {
        __extends(DoneEvent, _super);
        function DoneEvent(item, response) {
            var _this = _super.call(this, 'done') || this;
            _this.item = item;
            _this.response = response;
            return _this;
        }
        return DoneEvent;
    }(Event));
    Uq.DoneEvent = DoneEvent;
    /**
     * Upload item error event. Triggers on network errors etc.
     */
    var ErrorEvent = /** @class */ (function (_super) {
        __extends(ErrorEvent, _super);
        function ErrorEvent(item) {
            var _this = _super.call(this, 'error') || this;
            _this.item = item;
            return _this;
        }
        return ErrorEvent;
    }(Event));
    Uq.ErrorEvent = ErrorEvent;
    /**
     * Upload item abort event. Triggers when user aborts upload.
     */
    var AbortEvent = /** @class */ (function (_super) {
        __extends(AbortEvent, _super);
        function AbortEvent(item) {
            var _this = _super.call(this, 'abort') || this;
            _this.item = item;
            return _this;
        }
        return AbortEvent;
    }(Event));
    Uq.AbortEvent = AbortEvent;
    /**
     * Upload item finish event. Trigger after `done`, `error`, `abort`.
     */
    var FinishEvent = /** @class */ (function (_super) {
        __extends(FinishEvent, _super);
        function FinishEvent(item) {
            var _this = _super.call(this, 'finish') || this;
            _this.item = item;
            return _this;
        }
        return FinishEvent;
    }(Event));
    Uq.FinishEvent = FinishEvent;
})(Uq = exports.Uq || (exports.Uq = {}));
exports.Uq = Uq;
/**
 * Takes UQ options, returns a tuple of current state values (`items`, `progress`, `active`), pre-configured file change handler, and the UQ instance.
 */
function useUq(url, options) {
    if (options === void 0) { options = {}; }
    var field = options.field, concurrency = options.concurrency;
    var uq = react_1.useMemo(function () { return new Uq(url, { field: field, concurrency: concurrency }); }, [url, field, concurrency]);
    var _a = react_1.useState([]), items = _a[0], setItems = _a[1];
    var _b = react_1.useState(0), progress = _b[0], setProgress = _b[1];
    var _c = react_1.useState(false), active = _c[0], setActive = _c[1];
    var handleChange = react_1.useCallback(function (event) {
        var input = event.target;
        uq.push(input.files);
    }, [uq]);
    react_1.useEffect(function () {
        var handleChange = function (_a) {
            var items = _a.items, progress = _a.progress, active = _a.active;
            setItems(items);
            setProgress(progress);
            setActive(active);
        };
        uq.addEventListener('change', handleChange);
        return function () {
            uq.removeEventListener('change', handleChange);
        };
    }, [uq]);
    return [items, progress, active, handleChange, uq];
}
exports.useUq = useUq;
