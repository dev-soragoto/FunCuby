import assert from "node:assert/strict";
import { test } from "node:test";
import { bluetoothAccessError } from "../../src/core/ble/access.js";
import { SERVICE } from "../../src/core/ble/protocol.js";
import { BleTransport } from "../../src/core/ble/transport.js";
import { LOCALES, setLocale, translate } from "../../src/i18n/i18n.js";

test("Bluetooth checks distinguish insecure pages, unsupported browsers and policy blocks", () => {
    const bluetooth = { requestDevice() {} };
    assert.equal(
        bluetoothAccessError({ bluetooth, secure: false }).key,
        "errors.ble.insecure",
    );
    for (const unsupported of [null, {}])
        assert.equal(
            bluetoothAccessError({ bluetooth: unsupported, secure: true }).key,
            "errors.ble.unavailable",
        );
    assert.equal(
        bluetoothAccessError({
            bluetooth,
            secure: true,
            policy: { allowsFeature: (feature) => feature !== "bluetooth" },
        }).key,
        "errors.ble.blocked",
    );
    assert.equal(bluetoothAccessError({ bluetooth, secure: true }), null);
});

test("unsupported browsers never enter the device chooser", async () => {
    const transport = new BleTransport(null);
    await assert.rejects(transport.connect(), {
        key: "errors.ble.unavailable",
    });
    assert.equal(transport.state, "disconnected");
});

test("permission requests run synchronously in the user's click and can be retried", async () => {
    const calls = [];
    const transport = new BleTransport({
        requestDevice(options) {
            calls.push(options);
            return Promise.reject(
                new DOMException("Access denied", "NotAllowedError"),
            );
        },
    });
    const statuses = [];
    transport.addEventListener("status", ({ detail }) => statuses.push(detail));
    const first = transport.connect();
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { filters: [{ services: [SERVICE] }] });
    await assert.rejects(first, { key: "errors.ble.permissionDenied" });
    assert.deepEqual(
        statuses.map(({ state }) => state),
        ["choosing", "error"],
    );
    assert.equal(statuses.at(-1).message.key, "errors.ble.permissionDenied");
    await assert.rejects(transport.connect(), {
        key: "errors.ble.permissionDenied",
    });
    assert.equal(calls.length, 2);
});

test("chooser errors distinguish permission refusal, cancelled selection and adapter failure", async () => {
    for (const [name, key] of [
        ["SecurityError", "permissionDenied"],
        ["NotFoundError", "noDeviceSelected"],
        ["NotReadableError", "adapterUnavailable"],
    ]) {
        const cause = new DOMException("Chooser failed", name);
        const transport = new BleTransport({
            requestDevice: () => Promise.reject(cause),
        });
        await assert.rejects(transport.connect(), (error) => {
            assert.equal(error.key, `errors.ble.${key}`);
            assert.equal(error.cause, cause);
            for (const locale of LOCALES) {
                setLocale(locale);
                assert.ok(translate(error).length > 0);
                assert.notEqual(translate(error), error.key);
            }
            return true;
        });
        assert.equal(transport.state, "error");
    }
});

test("GATT errors and unexpected chooser errors keep their original meaning", async () => {
    const error = new DOMException("Service access denied", "SecurityError");
    const device = new EventTarget();
    device.name = "EP-123";
    device.gatt = {
        connect: () => Promise.reject(error),
        disconnect() {},
    };
    const transport = new BleTransport({ requestDevice: async () => device });
    await assert.rejects(transport.connect(), (actual) => actual === error);
    const unexpected = new TypeError("Invalid chooser options");
    const other = new BleTransport({
        requestDevice: () => Promise.reject(unexpected),
    });
    await assert.rejects(other.connect(), (actual) => actual === unexpected);
});

test("a device selected after cancellation cannot start a connection", async () => {
    let select;
    const transport = new BleTransport({
        requestDevice: () =>
            new Promise((resolve) => {
                select = resolve;
            }),
    });
    const pending = transport.connect();
    assert.equal(transport.state, "choosing");
    transport.disconnect();
    select({});
    await pending;
    assert.equal(transport.state, "disconnected");
    assert.equal(transport.device, null);
});

test("successful name-based selection still connects and subscribes to MIDI", async () => {
    const characteristic = new EventTarget();
    characteristic.properties = { notify: true, writeWithoutResponse: true };
    let subscribed = false;
    characteristic.startNotifications = async () => {
        subscribed = true;
    };
    const device = new EventTarget();
    device.name = "EP-123";
    device.gatt = {
        connect: async () => ({
            getPrimaryService: async () => ({
                getCharacteristic: async () => characteristic,
            }),
        }),
    };
    let options;
    const transport = new BleTransport({
        requestDevice(value) {
            options = value;
            return Promise.resolve(device);
        },
    });
    const states = [];
    transport.addEventListener("status", ({ detail }) =>
        states.push(detail.state),
    );
    await transport.connect({ byName: true });
    assert.deepEqual(options.optionalServices, [SERVICE]);
    assert.deepEqual(
        options.filters,
        ["EP-", "EP_MUSIC", "EASYPLAY"].map((namePrefix) => ({ namePrefix })),
    );
    assert.deepEqual(states, ["choosing", "connecting", "ready"]);
    assert.equal(subscribed, true);
    assert.equal(transport.state, "ready");
});
