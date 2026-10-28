import { formatNumber, t } from "../../i18n/i18n.js";
import { byId, el } from "../dom.js";

const GRADE_ROWS = ["300", "100", "50", "Miss"];
const percent = (value) =>
    `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const rounds = (count) => (count === Infinity ? "∞" : count);
const sentences = (...parts) =>
    parts.filter(Boolean).join(t("common.sentenceGap"));

/** Live counters under the practice keyboard. Follow mode reuses the slots for its own counts. */
export function showScore({ result, follow, round, rounds: total }) {
    byId("teach-score-label").textContent = t(
        follow ? "teach.stats.completed" : "teach.stats.score",
    );
    byId("teach-accuracy-label").textContent = t(
        follow ? "teach.stats.waits" : "teach.stats.accuracy",
    );
    byId("teach-combo-label").textContent = t(
        follow ? "teach.stats.wrong" : "teach.stats.combo",
    );
    byId("teach-score").textContent = formatNumber(
        follow ? result.completed : result.score,
    );
    byId("teach-accuracy").textContent = follow
        ? result.waits
        : percent(result.accuracy);
    byId("teach-combo").textContent = follow ? result.wrong : result.combo;
    byId("teach-count").textContent =
        `${follow ? result.completed : result.judged} / ${result.total}`;
    byId("teach-round").textContent = t("teach.stats.round", {
        round,
        total: rounds(total),
    });
}

export function resetScore(total) {
    byId("teach-score").textContent = "0";
    byId("teach-combo").textContent = "0";
    byId("teach-accuracy").textContent = percent(0);
    byId("teach-count").textContent = `0 / ${total}`;
}

export function hideResults() {
    byId("teach-results").hidden = true;
}

function timingSummary(meanErrorMs) {
    if (meanErrorMs === null) return t("teach.results.noHits");
    const error = formatNumber(Math.abs(meanErrorMs), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
    });
    return t(meanErrorMs < 0 ? "teach.results.early" : "teach.results.late", {
        error,
    });
}

function countCell(label, count) {
    const node = el("div");
    node.append(label, el("b", String(count)));
    return node;
}

/** Final card for a round. context is the translated "file · tracks · BPM." sentence. */
export function showResults({ result, follow, stopped, round, context }) {
    byId("teach-results").hidden = false;
    byId("teach-result-title").textContent = t(
        stopped ? "teach.results.stoppedTitle" : "teach.results.finishedTitle",
        {
            round,
        },
    );
    byId("teach-score-formula").hidden = follow;
    if (follow) {
        byId("teach-final-score").textContent =
            `${result.completed} / ${result.total}`;
        byId("teach-final-accuracy").textContent = t(
            "teach.results.followSummary",
            {
                waits: result.waits,
                wrong: result.wrong,
            },
        );
        byId("teach-result-counts").replaceChildren();
        byId("teach-result-timing").textContent = sentences(
            context,
            t("teach.results.followUntimed"),
            t(
                stopped
                    ? "teach.results.followStopped"
                    : "teach.results.followDone",
            ),
        );
        return;
    }
    byId("teach-final-score").textContent = formatNumber(result.score);
    byId("teach-final-accuracy").textContent = t(
        "teach.results.rhythmSummary",
        {
            accuracy: percent(result.accuracy),
            combo: result.maxCombo,
            od: result.od,
        },
    );
    byId("teach-result-counts").replaceChildren(
        ...GRADE_ROWS.map((grade) =>
            countCell(
                grade === "Miss" ? t("teach.feedback.miss") : grade,
                result.counts[grade],
            ),
        ),
        countCell(t("teach.feedback.wrong"), result.wrong),
    );
    byId("teach-result-timing").textContent = sentences(
        context,
        timingSummary(result.meanErrorMs),
        stopped && t("teach.results.stoppedMisses"),
    );
}
