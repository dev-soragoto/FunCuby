// Subset of the Web Bluetooth API used by src/transport.js; not yet in the bundled DOM typings.
interface BluetoothLEScanFilter {
    name?: string;
    namePrefix?: string;
    services?: string[];
}

interface RequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: string[];
    acceptAllDevices?: boolean;
}

interface BluetoothCharacteristicProperties {
    readonly read: boolean;
    readonly write: boolean;
    readonly writeWithoutResponse: boolean;
    readonly notify: boolean;
    readonly indicate: boolean;
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly properties: BluetoothCharacteristicProperties;
    readonly value?: DataView;

    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;

    writeValueWithResponse(value: BufferSource): Promise<void>;

    writeValueWithoutResponse(value: BufferSource): Promise<void>;
}

interface BluetoothRemoteGATTService {
    getCharacteristic(
        characteristic: string,
    ): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
    readonly connected: boolean;

    connect(): Promise<BluetoothRemoteGATTServer>;

    disconnect(): void;

    getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name?: string;
    readonly gatt?: BluetoothRemoteGATTServer;
}

interface Bluetooth extends EventTarget {
    requestDevice(options?: RequestDeviceOptions): Promise<BluetoothDevice>;
}

interface Navigator {
    readonly bluetooth?: Bluetooth;
}
