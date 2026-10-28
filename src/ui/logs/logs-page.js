import { hex } from "../../core/ble/protocol.js";
import { message } from "../../core/message.js";
import { MEMORY_LIMIT } from "../../core/storage/log-book.js";
import { getLocale, t, translate } from "../../i18n/i18n.js";
import { byId, download, el } from "../dom.js";

const TX_PHASES = ["queued", "writing", "success", "failed", "cancelled"];
const SOURCES = ["import", "workbench"];

function eventText(event) {
    if (event.kind === "note-on" || event.kind === "note-off")
        return `${event.kind} ${event.noteName} (${event.note}) ch${event.channel} v${event.velocity}`;
    if (event.kind === "state")
        return t("logs.event.state", { state: event.state, tick: event.tick });
    return `${event.kind}: ${translate(event.reason) || event.status || ""}`;
}

function summary(row) {
    if (row.direction === "TX")
        return `${translate(row.label)} · ${TX_PHASES.includes(row.phase) ? t(`logs.phase.${row.phase}`) : row.phase}`;
    if (!row.events?.length)
        return translate(row.label) || translate(row.message) || "—";
    return row.events.map(eventText).join(" / ");
}

const sourceText = (source) =>
    t(`logs.source.${SOURCES.includes(source) ? source : "device"}`);

function clockTime(iso) {
    const time = new Date(iso).toLocaleTimeString(getLocale(), {
        hour12: false,
    });
    return `${time}.${iso.match(/\.(\d+)/)?.[1] || "000"}`;
}

const searchText = (row) =>
    [
        row.direction,
        sourceText(row.source),
        summary(row),
        translate(row.message),
        hex(row.bytes || []),
    ]
        .join(" ")
        .toLowerCase();

function cell(...children) {
    const td = el("td");
    td.append(...children);
    return td;
}

export function initLogsPage({ book, notice, run }) {
    let paused = false,
        rows = [],
        renderTimer = null,
        detailRow = null,
        request = 0,
        starting = false;

    function logRow(row) {
        const details = el("button", t("logs.details"));
        details.type = "button";
        details.addEventListener("click", () => showDetail(row));
        const content = cell(el("div", summary(row)));
        if (row.message && row.events?.length)
            content.append(el("div", translate(row.message), "muted"));
        const tr = el("tr");
        tr.append(
            cell(
                el("div", `#${row.seq}`, "log-time"),
                el("div", clockTime(row.time), "log-time"),
            ),
            cell(
                el("span", row.direction, `direction ${row.direction}`),
                el("span", sourceText(row.source), "source-tag"),
            ),
            content,
            cell(el("code", hex(row.bytes || []) || "—", "log-hex")),
            cell(details),
        );
        return tr;
    }

    function emptyRow() {
        const td = el(
            "td",
            t(book.enabled ? "logs.empty.capturing" : "logs.empty.off"),
            "empty",
        );
        td.colSpan = 5;
        const tr = el("tr");
        tr.append(td);
        return tr;
    }

    function render() {
        const query = byId("search").value.trim().toLowerCase(),
            direction = byId("direction").value;
        const matches = rows
            .filter(
                (row) =>
                    (direction === "all" || row.direction === direction) &&
                    (!query || searchText(row).includes(query)),
            )
            .slice(0, MEMORY_LIMIT);
        byId("log-rows").replaceChildren(
            ...(matches.length ? matches.map(logRow) : [emptyRow()]),
        );
    }

    function showLatest() {
        rows = book.latest();
        render();
    }

    function scheduleRender() {
        if (paused || renderTimer) return;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            if (!paused) showLatest();
        }, 100);
    }

    function showDetail(row) {
        detailRow = row;
        byId("detail-content").textContent = JSON.stringify(
            {
                ...row,
                hex: hex(row.bytes || []),
                sharedState: row.events?.some((e) => e.kind === "state")
                    ? t("logs.detail.unverified")
                    : undefined,
            },
            null,
            2,
        );
        byId("detail-dialog").showModal();
    }

    async function load(older = false) {
        const id = ++request;
        const before =
            older && rows.length
                ? Math.min(...rows.map((r) => r.seq))
                : undefined;
        const page = await book.page(before);
        if (id !== request) return;
        rows = book.merge(page, rows, older);
        render();
    }

    function setPaused(value) {
        paused = value;
        byId("pause-logs").textContent = t(
            paused ? "logs.resumeView" : "logs.pauseView",
        );
    }

    function updateControls() {
        const toggle = byId("toggle-logging");
        toggle.textContent = t(
            starting
                ? "logs.starting"
                : book.enabled
                  ? "logs.stop"
                  : "logs.start",
        );
        toggle.disabled = starting;
        byId("pause-logs").disabled = !book.enabled;
    }

    async function startCapture() {
        if (starting) return;
        starting = true;
        updateControls();
        try {
            await load();
            book.setEnabled(true);
            setPaused(false);
            book.record({
                source: "workbench",
                label: message("log.captureOn"),
                message: message("log.captureOnDetail"),
            });
        } finally {
            starting = false;
            updateControls();
        }
    }

    async function stopCapture() {
        book.record({
            source: "workbench",
            label: message("log.captureOff"),
            message: message("log.captureOffDetail"),
        });
        book.setEnabled(false);
        updateControls();
        await book.flush();
        if (!paused) showLatest();
    }

    async function clearAll() {
        if (!confirm(t("logs.confirmDelete"))) return;
        book.setEnabled(false);
        setPaused(false);
        request++;
        updateControls();
        clearTimeout(renderTimer);
        renderTimer = null;
        await book.clear();
        rows = [];
        updateControls();
        render();
    }

    async function exportAll() {
        const { blob, complete } = await book.export();
        if (!complete) notice(message("logs.exportPartial"), true);
        download(blob, `ep1-logs-${Date.now()}.jsonl`);
    }

    async function importFile() {
        const input = byId("import"),
            file = input.files[0];
        input.value = "";
        if (!file) return;
        await book.import(file);
        await load();
        notice(message("logs.imported"));
    }

    book.addEventListener("record", scheduleRender);
    for (const id of ["search", "direction"])
        byId(id).addEventListener("input", render);
    byId("pause-logs").addEventListener(
        "click",
        run(async () => {
            setPaused(!paused);
            if (!paused) await load();
            render();
        }),
    );
    byId("more-logs").addEventListener(
        "click",
        run(() => {
            setPaused(true);
            return load(true);
        }),
    );
    byId("toggle-logging").addEventListener(
        "click",
        run(() => (book.enabled ? stopCapture() : startCapture())),
    );
    byId("delete-logs").addEventListener("click", run(clearAll));
    byId("export").addEventListener("click", run(exportAll));
    byId("import").addEventListener("change", run(importFile));
    byId("close-detail").addEventListener("click", () =>
        byId("detail-dialog").close(),
    );
    byId("copy-detail").addEventListener(
        "click",
        run(async () => {
            await navigator.clipboard.writeText(hex(detailRow.bytes || []));
            notice(message("logs.copied"));
        }),
    );
    setPaused(false);
    updateControls();
    return { load };
}
