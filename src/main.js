import { BleTransport } from "./core/ble/transport.js";
import { describe, message } from "./core/message.js";
import { initScreenWakeLock } from "./core/screen-wake-lock.js";
import { LogBook, MEMORY_LIMIT } from "./core/storage/log-book.js";
import { LogStore } from "./core/storage/log-store.js";
import { preferences } from "./core/storage/preferences.js";
import { t } from "./i18n/i18n.js";
import { initDevicePage } from "./ui/device/device-page.js";
import { reportErrors } from "./ui/dom.js";
import { initLogsPage } from "./ui/logs/logs-page.js";
import { notice } from "./ui/notice.js";
import { initPlayPage } from "./ui/play/play-page.js";
import { initSendPage } from "./ui/send/send-page.js";
import { initLocalePicker } from "./ui/locale-picker.js";
import { initTeachPage } from "./ui/teach/teach-page.js";
import { initThemePicker } from "./ui/theme-picker.js";

const TABS = ["device", "send", "play", "teach", "logs", "about"];

async function initialize() {
    initLocalePicker(preferences);
    initThemePicker(preferences);
    initScreenWakeLock();
    const transport = new BleTransport(),
        store = new LogStore(),
        book = new LogBook(store);
    const run = reportErrors((error) => {
        notice(error, true);
        book.record({
            direction: "ERR",
            source: "workbench",
            label: message("log.actionFailed"),
            message: describe(error),
        });
    });
    store.onError = (error) => notice(error, true);
    book.addEventListener("storage-error", ({ detail: { error, unsaved } }) => {
        notice(
            message("log.storageFailed", {
                reason: describe(error),
                limit: MEMORY_LIMIT,
                unsaved,
            }),
            true,
        );
    });
    transport.addEventListener("tx", ({ detail: { id, ...detail } }) => {
        book.record({ ...detail, direction: "TX", txId: id, events: [] });
    });

    let teach = null;
    const device = initDevicePage({
        transport,
        book,
        preferences,
        notice,
        run,
        onNote: (event, receivedAt) => teach?.receive(event, receivedAt),
        onMappingChange: () => teach?.mappingChanged(),
    });
    const logs = initLogsPage({ book, notice, run });
    const send = initSendPage({
        transport,
        book,
        notice,
        run,
        cancelPlayback: async () => {
            if (play.player.state === "idle") return false;
            await play.player.stop();
            return true;
        },
    });
    const play = initPlayPage({
        transport,
        notice,
        isTeachingBusy: () => teach?.busy ?? false,
        onBusyChange: send.setBusy,
    });
    teach = initTeachPage({
        transport,
        player: play.player,
        notice,
        preferences,
        getOffset: device.getOffset,
        setOffset: device.setOffset,
        onStateChange: play.refresh,
    });

    function navigate(tab) {
        if (!TABS.includes(tab)) tab = "device";
        if (tab !== "teach") teach.pause(t("teach.status.leftPage"));
        for (const node of document.querySelectorAll("[data-tab]")) {
            const selected = node.dataset.tab === tab;
            node.classList.toggle("selected", selected);
            node.setAttribute("aria-current", selected ? "page" : "false");
        }
        for (const node of document.querySelectorAll(".panel"))
            node.hidden = node.id !== `panel-${tab}`;
        if (tab === "logs") logs.load().catch((error) => notice(error, true));
    }

    for (const button of document.querySelectorAll("[data-tab]"))
        button.addEventListener("click", () => {
            location.hash = button.dataset.tab;
        });
    window.addEventListener("hashchange", () =>
        navigate(location.hash.slice(1)),
    );

    await logs.load();
    book.record({
        source: "workbench",
        label: message("log.ready"),
        message: message("log.readyDetail"),
    });
    navigate(location.hash.slice(1));
}

initialize().catch((error) =>
    notice(message("app.initFailed", { reason: describe(error) }), true),
);
