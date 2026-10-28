import { AppError } from "../message.js";

/** Synchronous checks keep requestDevice() inside the user's click gesture. */
export function bluetoothAccessError({
    bluetooth = globalThis.navigator?.bluetooth,
    secure = globalThis.isSecureContext,
    policy = globalThis.document?.permissionsPolicy ??
        globalThis.document?.featurePolicy,
} = {}) {
    if (secure === false) return new AppError("errors.ble.insecure");
    if (typeof bluetooth?.requestDevice !== "function")
        return new AppError("errors.ble.unavailable");
    if (policy?.allowsFeature?.("bluetooth") === false)
        return new AppError("errors.ble.blocked");
    return null;
}

/** Only classify chooser failures; GATT errors can have different meanings. */
export function bluetoothRequestError(error) {
    const key = {
        NotAllowedError: "permissionDenied",
        SecurityError: "permissionDenied",
        NotFoundError: "noDeviceSelected",
        NotReadableError: "adapterUnavailable",
    }[error?.name];
    return key
        ? new AppError(`errors.ble.${key}`, {}, { cause: error })
        : error;
}
