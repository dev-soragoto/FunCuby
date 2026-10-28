import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { twoNotes } from "../unit/fixtures.js";

// Headless Chromium smoke test: page boots, keyboards render and mapping stays in sync.
const BROWSER =
    process.env.BROWSER ||
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "18573" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
});
let browser, socket;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
    for (let i = 0; i < 40; i++) {
        try {
            if ((await fetch("http://127.0.0.1:18573")).ok) break;
        } catch {
            /* Server not listening yet. */
        }
        await wait(100);
    }
    browser = spawn(
        BROWSER,
        [
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--remote-debugging-port=0",
            "--lang=zh-CN",
            `--user-data-dir=${resolve(".test-artifacts/edge-profile")}`,
            "about:blank",
        ],
        { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    const debuggerUrl = await new Promise((res, rej) => {
        let output = "";
        const timer = setTimeout(
            () => rej(Error("Browser debugger startup timed out")),
            20000,
        );
        browser.stderr.on("data", (bytes) => {
            output += bytes;
            const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) {
                clearTimeout(timer);
                res(match[1]);
            }
        });
        browser.on("error", rej);
    });
    const port = new URL(debuggerUrl).port;
    const tabs = await (
        await fetch(`http://127.0.0.1:${port}/json/list`)
    ).json();
    socket = new WebSocket(
        tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl,
    );
    await new Promise((res, rej) => {
        socket.addEventListener("open", res, { once: true });
        socket.addEventListener("error", rej, { once: true });
    });
    let seq = 0;
    const pending = new Map(),
        errors = [];
    socket.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data);
        if (msg.id) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error
                ? p.reject(Error(JSON.stringify(msg.error)))
                : p.resolve(msg.result);
        } else if (msg.method === "Runtime.exceptionThrown")
            errors.push(msg.params.exceptionDetails);
    });
    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = ++seq;
            pending.set(id, { resolve, reject });
            socket.send(JSON.stringify({ id, method, params }));
        });
    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
    };
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 1080,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await send("Page.navigate", { url: "http://127.0.0.1:18573" });
    for (let i = 0; i < 60; i++) {
        if (
            await evaluate(
                'document.querySelectorAll("#teach-keyboard .note").length === 15',
            )
        )
            break;
        await wait(100);
    }
    const inspect = () =>
        evaluate(`(() => {
    const labels = id => [...document.querySelectorAll('#' + id + ' .note')].map(n => n.textContent);
    return { device: labels('keyboard'), teaching: labels('teach-keyboard'), keys: ['keyboard', 'teach-keyboard'].map(id => document.querySelectorAll('#' + id + ' .sharp-key').length), sharpLabels: document.querySelectorAll('.sharp-key .note, .sharp-key[title]').length, banners: document.querySelectorAll('.eyebrow').length, wakeUI: document.querySelectorAll('.wake-lock-controls, #wake-lock-status, #wake-lock-retry').length, notice: document.getElementById('notice').textContent };
  })()`);
    const state = await inspect();
    assert.equal(state.device.length, 15);
    assert.deepEqual(state.device, state.teaching);
    assert.deepEqual(state.keys, [10, 10]);
    assert.equal(state.sharpLabels, 0);
    assert.equal(state.banners, 0);
    assert.equal(state.wakeUI, 0);
    assert.equal(state.device[0], "C4");
    assert.equal(state.device.at(-1), "C6");
    assert(!state.notice.includes("初始化失败"));
    console.log(
        "PASS: initial keyboard labels, 15 main keys, 10 unlabelled small keys, no banners or wake-lock UI",
    );
    const firstKeyAfter = async (script) => {
        await evaluate(script);
        await wait(50);
        const { device, teaching } = await inspect();
        assert.deepEqual(device, teaching);
        return device[0];
    };
    for (const [offset, first] of [
        [1, "C♯4"],
        [-12, "C3"],
        [12, "C5"],
    ]) {
        assert.equal(
            await firstKeyAfter(
                `document.getElementById('offset').value = ${offset}; document.getElementById('apply-offset').click()`,
            ),
            first,
        );
    }
    assert.equal(
        await firstKeyAfter(
            `document.getElementById('teach-first-note').value = 62; document.getElementById('teach-apply-map').click()`,
        ),
        "D4",
    );
    assert.equal(
        await firstKeyAfter(`document.getElementById('reset-offset').click()`),
        "C4",
    );
    console.log(
        "PASS: device/teaching mapping changes synchronize in both directions and reset",
    );
    await mkdir(".test-artifacts", { recursive: true });
    await writeFile(
        ".test-artifacts/device.png",
        Buffer.from(
            (await send("Page.captureScreenshot", { format: "png" })).data,
            "base64",
        ),
    );
    await evaluate(`location.hash = 'teach'`);
    await wait(150);
    assert.equal(
        await evaluate(`document.getElementById('panel-teach').hidden`),
        false,
    );
    await writeFile(
        ".test-artifacts/teaching.png",
        Buffer.from(
            (
                await send("Page.captureScreenshot", {
                    format: "png",
                    captureBeyondViewport: true,
                })
            ).data,
            "base64",
        ),
    );
    const midiPath = resolve(".test-artifacts/two-notes.mid");
    await writeFile(midiPath, twoNotes());
    const { root } = await send("DOM.getDocument");
    for (const id of ["midi-file", "teach-file"]) {
        const { nodeId } = await send("DOM.querySelector", {
            nodeId: root.nodeId,
            selector: `#${id}`,
        });
        await send("DOM.setFileInputFiles", { nodeId, files: [midiPath] });
    }
    const loadedExpression = `document.querySelectorAll('#midi-tracks tr').length > 0 && document.querySelectorAll('.score-beat').length > 0`;
    for (let i = 0; i < 40 && !(await evaluate(loadedExpression)); i++)
        await wait(50);
    const loaded = await evaluate(`({
        track: [...document.querySelector('#midi-tracks tr').cells].map(cell => cell.querySelector('select, input:not([type=checkbox])')?.value ?? cell.textContent),
        tempo: document.getElementById('tempo-info').textContent,
        beats: document.querySelectorAll('.score-beat').length,
        digits: [...document.querySelectorAll('.score-digit')].map(node => node.textContent),
        teachTracks: document.querySelectorAll('#teach-tracks input:checked').length,
    })`);
    assert.deepEqual(loaded.track, [
        "",
        "1. Lead",
        "2",
        "16",
        "5",
        "timestamp",
        "press-only",
        "0",
        "101",
    ]);
    assert.equal(loaded.tempo, "原曲 120 BPM · 最短音 500 ms");
    assert.equal(loaded.beats, 3);
    assert.deepEqual(loaded.digits, ["1", "2"]);
    assert.equal(loaded.teachTracks, 1);
    console.log(
        "PASS: MIDI upload renders the play track table and the numbered score",
    );
    await send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
    });
    await wait(100);
    assert.equal(
        await evaluate(`document.documentElement.scrollWidth > innerWidth`),
        false,
    );
    assert.deepEqual(errors, []);
    console.log(
        "PASS: teaching navigation, mobile page width, no browser runtime exceptions",
    );
} finally {
    if (socket) socket.close();
    if (browser) browser.kill();
    server.kill();
}
