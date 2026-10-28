import { AppError, describe, message } from "../message.js";
import { CHARACTERISTIC, classify, hex, SERVICE } from "./protocol.js";

const deviceModel = (device) => {
    const model = classify(device.name || "");
    if (model === "EP2") throw new AppError("errors.ble.ep2");
    return model;
};
const requireNotify = (characteristic) => {
    if (
        !characteristic.properties.notify &&
        !characteristic.properties.indicate
    )
        throw new AppError("errors.ble.noNotify");
};

export class BleTransport extends EventTarget {
    constructor(bluetooth = globalThis.navigator?.bluetooth) {
        super();
        this.bluetooth = bluetooth;
        this.device = null;
        this.characteristic = null;
        this.state = "disconnected";
        this.generation = 0;
        this.queue = Promise.resolve();
        this.job = 0;
        this.pendingTasks = new Map();
        this.onValue = (e) =>
            this.emit("rx", {
                bytes: Array.from(
                    new Uint8Array(
                        e.target.value.buffer,
                        e.target.value.byteOffset,
                        e.target.value.byteLength,
                    ),
                ),
            });
        this.onDisconnect = () => this.cleanup(message("ble.lost"));
    }

    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    status(state, text, extra = {}) {
        this.state = state;
        this.emit("status", { state, message: text, ...extra });
    }

    async connect({ byName = false, reconnect = false } = {}) {
        if (["choosing", "connecting", "ready"].includes(this.state))
            throw new AppError("errors.ble.busy");
        if (!this.bluetooth) throw new AppError("errors.ble.unavailable");
        const generation = ++this.generation;
        this.status(
            "choosing",
            message(reconnect ? "ble.reconnecting" : "ble.choosing"),
        );
        try {
            const device =
                reconnect && this.device
                    ? this.device
                    : await this.bluetooth.requestDevice(
                          byName
                              ? {
                                    filters: [
                                        "EP-",
                                        "EP_MUSIC",
                                        "EASYPLAY",
                                    ].map((namePrefix) => ({ namePrefix })),
                                    optionalServices: [SERVICE],
                                }
                              : { filters: [{ services: [SERVICE] }] },
                      );
            if (generation !== this.generation) return;
            const model = deviceModel(device);
            this.device?.removeEventListener(
                "gattserverdisconnected",
                this.onDisconnect,
            );
            this.device = device;
            device.addEventListener(
                "gattserverdisconnected",
                this.onDisconnect,
            );
            this.status("connecting", message("ble.connecting"), {
                name: device.name,
                model,
            });
            const server = await device.gatt.connect();
            if (generation !== this.generation) {
                device.gatt.disconnect();
                return;
            }
            const service = await server.getPrimaryService(SERVICE);
            const characteristic =
                await service.getCharacteristic(CHARACTERISTIC);
            if (generation !== this.generation) return;
            this.characteristic = characteristic;
            requireNotify(characteristic);
            characteristic.addEventListener(
                "characteristicvaluechanged",
                this.onValue,
            );
            await characteristic.startNotifications();
            if (generation !== this.generation) return;
            const p = characteristic.properties;
            this.status(
                "ready",
                message(model === "UNKNOWN" ? "ble.readyUnknown" : "ble.ready"),
                {
                    name: device.name || "",
                    model,
                    properties: {
                        read: !!p.read,
                        notify: !!p.notify,
                        indicate: !!p.indicate,
                        write: !!p.write,
                        writeWithoutResponse: !!p.writeWithoutResponse,
                    },
                    writeMode: p.writeWithoutResponse
                        ? "writeWithoutResponse"
                        : p.write
                          ? "writeWithResponse"
                          : null,
                },
            );
        } catch (error) {
            if (generation !== this.generation) return;
            this.device?.gatt?.disconnect();
            this.cleanup(describe(error), "error");
            throw error;
        }
    }

    cleanup(text = message("ble.disconnected"), state = "disconnected") {
        this.generation++;
        this.cancel();
        this.characteristic?.removeEventListener(
            "characteristicvaluechanged",
            this.onValue,
        );
        this.characteristic = null;
        this.status(state, text);
    }

    disconnect() {
        this.device?.gatt?.disconnect();
        this.cleanup();
    }

    pendingChanged() {
        this.emit("pending", { lines: [...this.pendingTasks.values()] });
    }

    removePending(id) {
        if (this.pendingTasks.delete(id)) this.pendingChanged();
    }

    cancel() {
        this.job++;
        this.pendingTasks.clear();
        this.pendingChanged();
        this.cancelSleep?.();
    }

    send(packets, label = message("tx.manual")) {
        return this.sendSequence(
            packets.map((bytes) => ({ bytes })),
            label,
        );
    }

    sendSequence(steps, label = message("tx.manual")) {
        if (this.state !== "ready" || !this.characteristic)
            return Promise.reject(new AppError("errors.connectFirst"));
        const generation = this.generation,
            job = this.job,
            characteristic = this.characteristic;
        const mode = characteristic.properties.writeWithoutResponse
            ? "writeWithoutResponse"
            : characteristic.properties.write
              ? "writeWithResponse"
              : null;
        if (!mode)
            return Promise.reject(new AppError("errors.ble.notWritable"));
        const entries = steps.map((step) => ({
            id: globalThis.crypto.randomUUID(),
            ...step,
            ...(step.bytes ? { bytes: Uint8Array.from(step.bytes) } : {}),
        }));
        for (const { id, bytes, sleepMs } of entries)
            this.pendingTasks.set(id, bytes ? hex(bytes) : `sleep ${sleepMs}`);
        this.pendingChanged();
        const tasks = entries.map((step) => {
            const { id } = step;
            if (step.sleepMs !== undefined) {
                const task = this.queue
                    .catch(() => {})
                    .then(() => {
                        if (
                            generation !== this.generation ||
                            job !== this.job ||
                            this.state !== "ready" ||
                            step.sleepMs === 0
                        ) {
                            this.removePending(id);
                            return;
                        }
                        return new Promise((resolve) => {
                            const finish = () => {
                                clearTimeout(timer);
                                this.cancelSleep = null;
                                this.removePending(id);
                                resolve();
                            };
                            const timer = setTimeout(finish, step.sleepMs);
                            this.cancelSleep = finish;
                        });
                    });
                this.queue = task;
                return task;
            }
            const bytes = step.bytes;
            this.emit("tx", {
                id,
                phase: "queued",
                bytes: [...bytes],
                label,
                writeMode: mode,
            });
            const task = this.queue
                .catch(() => {})
                .then(async () => {
                    this.removePending(id);
                    if (
                        generation !== this.generation ||
                        job !== this.job ||
                        this.state !== "ready"
                    ) {
                        this.emit("tx", {
                            id,
                            phase: "cancelled",
                            bytes: [...bytes],
                            label,
                            writeMode: mode,
                        });
                        return;
                    }
                    this.emit("tx", {
                        id,
                        phase: "writing",
                        bytes: [...bytes],
                        label,
                        writeMode: mode,
                    });
                    try {
                        await characteristic[
                            mode === "writeWithoutResponse"
                                ? "writeValueWithoutResponse"
                                : "writeValueWithResponse"
                        ](bytes);
                        this.emit("tx", {
                            id,
                            phase: "success",
                            bytes: [...bytes],
                            label,
                            writeMode: mode,
                            message: message("tx.written"),
                        });
                    } catch (error) {
                        this.cancel(); // Stop the rest of a batch after a failed write; never replay uncertain writes.
                        this.emit("tx", {
                            id,
                            phase: "failed",
                            bytes: [...bytes],
                            label,
                            writeMode: mode,
                            message: error.message,
                        });
                        throw new AppError(
                            "errors.ble.writeFailed",
                            { label, reason: error.message, hex: hex(bytes) },
                            { cause: error },
                        );
                    }
                });
            this.queue = task;
            return task;
        });
        return Promise.all(tasks);
    }
}
