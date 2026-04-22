let performanceChart = null;
let allEventsCache = [];
let statusMessageTimeoutId = null;
const PERFORMANCE_ROLLING_DAYS = 7;
const DIFFICULTY_LABELS = {
    rookie: "Rookie",
    veteran: "Veteran",
    all_star: "All-Star",
    hall_of_fame: "Hall of Fame",
    legend: "Legend",
    goat: "G.O.A.T."
};
const GAME_MODE_LABELS = {
    conquest: "Conquest",
    ranked: "Ranked",
    events: "Events",
    moments: "Moments",
    diamond_quest: "Diamond Quest",
    showdown: "Showdown",
    vs_cpu: "vs CPU",
    miniseasons: "Miniseasons"
};

function normalizeUtcTimestamp(isoString) {
    if (typeof isoString !== "string") {
        return isoString;
    }

    return /(?:Z|[+-]\d{2}:\d{2})$/.test(isoString)
        ? isoString
        : `${isoString}Z`;
}

function getOrdinal(day) {
    if (day >= 11 && day <= 13) {
        return "th";
    }

    switch (day % 10) {
        case 1:
            return "st";
        case 2:
            return "nd";
        case 3:
            return "rd";
        default:
            return "th";
    }
}

function formatTimestamp(isoString) {
    const date = new Date(normalizeUtcTimestamp(isoString));

    if (isNaN(date)) {
        return isoString; // fallback if parsing fails
    }

    const time = date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    }).toLowerCase();

    const month = date.toLocaleDateString("en-US", {
        month: "long"
    });

    const day = date.getDate();
    const year = date.getFullYear();

    return `${time} on ${month} ${day}${getOrdinal(day)}, ${year}`;
}

function formatOutcome(outcome) {
    return outcome
        .replaceAll("_", " ")
        .replace(/\b\w/g, function (char) {
            return char.toUpperCase();
        });
}

function formatSelectionLabel(value, labels) {
    if (!value) {
        return "—";
    }

    return labels[value] || formatOutcome(value);
}

function displayRate(value) {
    if (typeof value !== "string") {
        return ".000";
    }
    return value.startsWith("0.") ? "." + value.split(".")[1] : value;
}

function formatRateNumber(value) {
    const fixed = Number(value).toFixed(3);
    return fixed.startsWith("0.") ? `.${fixed.split(".")[1]}` : fixed;
}

function formatEventShare(count, totalEvents) {
    if (!totalEvents) {
        return "0.0%";
    }

    return `${((count / totalEvents) * 100).toFixed(1)}%`;
}

function getAxisBounds(values, options = {}) {
    const paddingRatio = options.paddingRatio ?? 0.1;
    const minimumPadding = options.minimumPadding ?? 0.02;
    const clampMin = options.clampMin;
    const clampMax = options.clampMax;
    const minValue = Math.min.apply(null, values);
    const maxValue = Math.max.apply(null, values);
    const span = maxValue - minValue;
    const padding = Math.max(span * paddingRatio, minimumPadding);
    let lowerBound = minValue - padding;
    let upperBound = maxValue + padding;

    if (typeof clampMin === "number") {
        lowerBound = Math.max(clampMin, lowerBound);
    }

    if (typeof clampMax === "number") {
        upperBound = Math.min(clampMax, upperBound);
    }

    if (lowerBound === upperBound) {
        upperBound = lowerBound + minimumPadding;
    }

    return {
        min: lowerBound,
        max: upperBound
    };
}

function showMessage(message, isError = false) {
    const cssClass = isError ? "text-danger" : "text-success";
    const statusMessage = $("#status-message");

    if (statusMessageTimeoutId) {
        window.clearTimeout(statusMessageTimeoutId);
        statusMessageTimeoutId = null;
    }

    statusMessage
        .stop(true, true)
        .show()
        .removeClass("text-danger text-success")
        .addClass(cssClass)
        .text(message);

    if (!isError) {
        statusMessageTimeoutId = window.setTimeout(function () {
            statusMessage.fadeOut(400, function () {
                $(this)
                    .text("")
                    .removeClass("text-danger text-success")
                    .show();
            });
            statusMessageTimeoutId = null;
        }, 10000);
    }
}

function getSelectionGroup(groupName) {
    return $(`[data-selection-group="${groupName}"]`);
}

function setSelectedValue(groupName, value) {
    getSelectionGroup(groupName).find(".selection-button").each(function () {
        const isSelected = Boolean(value) && $(this).attr("data-selection-value") === value;

        $(this)
            .toggleClass("active btn-primary text-white", isSelected)
            .toggleClass("btn-outline-secondary", !isSelected)
            .attr("aria-pressed", isSelected ? "true" : "false");
    });
}

function getSelectedValue(groupName) {
    return getSelectionGroup(groupName).find(".selection-button.active").attr("data-selection-value") || "";
}

function bindSelectionButtons() {
    $(".selection-button").on("click", function () {
        const button = $(this);
        const groupName = button.closest("[data-selection-group]").attr("data-selection-group");
        const nextValue = button.hasClass("active")
            ? ""
            : button.attr("data-selection-value");

        setSelectedValue(groupName, nextValue);
        syncGoatAvailability();
    });
}

function syncGoatAvailability() {
    const goatButton = getSelectionGroup("difficulty_level").find('[data-selection-value="goat"]');
    const goatAllowed = getSelectedValue("game_mode") === "diamond_quest";

    if (!goatAllowed && goatButton.hasClass("active")) {
        setSelectedValue("difficulty_level", "");
    }

    if (!goatAllowed) {
        goatButton
            .prop("disabled", true)
            .removeClass("active btn-primary text-white btn-outline-secondary")
            .addClass("btn-secondary disabled opacity-50")
            .attr("aria-pressed", "false");
        return;
    }

    goatButton
        .prop("disabled", false)
        .removeClass("btn-secondary disabled opacity-50");

    if (!goatButton.hasClass("active")) {
        goatButton.addClass("btn-outline-secondary");
    }
}

function getStatsFilterValues(groupName) {
    return $(`.stats-filter-checkbox[data-filter-group="${groupName}"]:checked`).map(function () {
        return $(this).val();
    }).get();
}

function setStatsFilterGroup(groupName, shouldCheck) {
    $(`.stats-filter-checkbox[data-filter-group="${groupName}"]`).prop("checked", shouldCheck);
}

function getStatsFilterParams() {
    return {
        limit: $("#stats-limit").val(),
        difficulty_levels: getStatsFilterValues("stats-difficulty-levels").join(","),
        game_modes: getStatsFilterValues("stats-game-modes").join(",")
    };
}

function updateStats(stats) {
    $("#stat-at-bats").text(stats.at_bats);
    $("#stat-hits").text(stats.hits);
    $("#stat-avg").text(displayRate(stats.batting_average));
    $("#stat-slg").text(displayRate(stats.slugging_percentage));
    $("#stat-ops").text(stats.ops);
    $("#stat-singles").text(stats.singles);
    $("#stat-doubles").text(stats.doubles);
    $("#stat-triples").text(stats.triples);
    $("#stat-home-runs").text(stats.home_runs);
    $("#stat-outs").text(stats.outs);
    $("#stat-total-bases").text(stats.total_bases);
    $("#stat-sample-size").text(stats.sample_size);
    $("#stat-singles-share").text(formatEventShare(stats.singles, stats.at_bats));
    $("#stat-doubles-share").text(formatEventShare(stats.doubles, stats.at_bats));
    $("#stat-triples-share").text(formatEventShare(stats.triples, stats.at_bats));
    $("#stat-home-runs-share").text(formatEventShare(stats.home_runs, stats.at_bats));
    $("#stat-outs-share").text(formatEventShare(stats.outs, stats.at_bats));
}

function renderEvents(events) {
    const tbody = $("#events-table-body");
    tbody.empty();

    if (!events || events.length === 0) {
        tbody.append(`
            <tr>
                <td colspan="5" class="text-center text-muted">No events yet</td>
            </tr>
        `);
        return;
    }

    events.forEach(function (event) {
        tbody.append(`
            <tr>
                <td>${event.id}</td>
                <td>${formatOutcome(event.outcome)}</td>
                <td>${formatSelectionLabel(event.difficulty_level, DIFFICULTY_LABELS)}</td>
                <td>${formatSelectionLabel(event.game_mode, GAME_MODE_LABELS)}</td>
                <td>${formatTimestamp(event.created_at)}</td>
            </tr>
        `);
    });
}

function updateEventsToday(events) {
    const todayKey = getLocalDayKey(new Date());
    const eventsToday = (Array.isArray(events) ? events : []).reduce(function (count, event) {
        const date = new Date(normalizeUtcTimestamp(event.created_at));

        if (isNaN(date)) {
            return count;
        }

        return getLocalDayKey(date) === todayKey ? count + 1 : count;
    }, 0);

    $("#stat-events-today").text(eventsToday);
}

function getLocalDayKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getStartOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function createLocalDateFromKey(dayKey) {
    const parts = dayKey.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function compareEventsByTime(a, b) {
    const firstDate = new Date(normalizeUtcTimestamp(a.created_at));
    const secondDate = new Date(normalizeUtcTimestamp(b.created_at));
    const firstTime = firstDate.getTime();
    const secondTime = secondDate.getTime();

    if (firstTime !== secondTime) {
        return firstTime - secondTime;
    }

    return (a.id || 0) - (b.id || 0);
}

function applyOutcomeToTotals(totals, outcome) {
    totals.atBats += 1;

    switch (outcome) {
        case "single":
            totals.hits += 1;
            totals.totalBases += 1;
            break;
        case "double":
            totals.hits += 1;
            totals.totalBases += 2;
            break;
        case "triple":
            totals.hits += 1;
            totals.totalBases += 3;
            break;
        case "home_run":
            totals.hits += 1;
            totals.totalBases += 4;
            break;
        default:
            break;
    }
}

function calculateRunningRates(totals) {
    const battingAverage = totals.atBats ? totals.hits / totals.atBats : 0;
    const sluggingPercentage = totals.atBats ? totals.totalBases / totals.atBats : 0;

    return {
        avg: battingAverage,
        ops: battingAverage + sluggingPercentage
    };
}

function createEmptyTotals() {
    return {
        atBats: 0,
        hits: 0,
        totalBases: 0
    };
}

function buildDailyRollingSeries(events, rollingDays = PERFORMANCE_ROLLING_DAYS) {
    if (!Array.isArray(events) || events.length === 0) {
        return [];
    }

    const sortedEvents = events.slice().sort(compareEventsByTime);
    const dailyTotals = new Map();

    sortedEvents.forEach(function (event) {
        const date = new Date(normalizeUtcTimestamp(event.created_at));

        if (isNaN(date)) {
            return;
        }

        const dayKey = getLocalDayKey(date);
        const totals = dailyTotals.get(dayKey) || createEmptyTotals();
        applyOutcomeToTotals(totals, event.outcome);
        dailyTotals.set(dayKey, totals);
    });

    if (dailyTotals.size === 0) {
        return [];
    }

    const dayKeys = Array.from(dailyTotals.keys());
    const firstDay = createLocalDateFromKey(dayKeys[0]);
    const lastDay = createLocalDateFromKey(dayKeys[dayKeys.length - 1]);
    const points = [];
    const rollingWindow = [];
    const rollingTotals = createEmptyTotals();

    for (let cursor = new Date(firstDay); cursor <= lastDay; cursor = addDays(cursor, 1)) {
        const dayKey = getLocalDayKey(cursor);
        const dayTotals = dailyTotals.get(dayKey) || createEmptyTotals();
        rollingWindow.push(dayTotals);
        rollingTotals.atBats += dayTotals.atBats;
        rollingTotals.hits += dayTotals.hits;
        rollingTotals.totalBases += dayTotals.totalBases;

        if (rollingWindow.length > rollingDays) {
            const expiredTotals = rollingWindow.shift();
            rollingTotals.atBats -= expiredTotals.atBats;
            rollingTotals.hits -= expiredTotals.hits;
            rollingTotals.totalBases -= expiredTotals.totalBases;
        }

        const rates = calculateRunningRates(rollingTotals);
        points.push({
            x: getStartOfLocalDay(cursor),
            avg: rates.avg,
            ops: rates.ops,
            atBats: rollingTotals.atBats
        });
    }

    return points;
}

function filterSeriesByWindow(points, windowValue) {
    if (windowValue === "all" || points.length === 0) {
        return points;
    }

    const windowDays = Number(windowValue);
    if (!windowDays) {
        return points;
    }

    const latestDay = points[points.length - 1].x;
    const cutoff = getStartOfLocalDay(addDays(latestDay, -(windowDays - 1)));

    return points.filter(function (point) {
        return point.x >= cutoff;
    });
}

function determineChartUnit(points) {
    if (points.length <= 1) {
        return "day";
    }

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const spanInDays = Math.round((points[points.length - 1].x - points[0].x) / millisecondsPerDay);

    if (spanInDays > 180) {
        return "month";
    }

    if (spanInDays > 60) {
        return "week";
    }

    return "day";
}

function renderPerformanceChart(events) {
    const emptyState = $("#performance-chart-empty");
    const chartContainer = $("#performance-chart-container");

    if (performanceChart) {
        performanceChart.destroy();
        performanceChart = null;
    }

    if (typeof Chart === "undefined") {
        emptyState.text("Chart library failed to load.");
        emptyState.show();
        chartContainer.hide();
        return;
    }

    const series = filterSeriesByWindow(buildDailyRollingSeries(events), $("#chart-window").val());

    if (series.length === 0) {
        emptyState.text(`Add events to see the ${PERFORMANCE_ROLLING_DAYS}-day rolling AVG and OPS trend.`);
        emptyState.show();
        chartContainer.hide();
        return;
    }

    emptyState.hide();
    chartContainer.show();

    const avgValues = series.map(function (point) {
        return point.avg;
    });
    const opsValues = series.map(function (point) {
        return point.ops;
    });
    const avgBounds = getAxisBounds(avgValues, { clampMin: 0, clampMax: 1, minimumPadding: 0.01 });
    const opsBounds = getAxisBounds(opsValues, { clampMin: 0, minimumPadding: 0.03 });
    const chartElement = document.getElementById("performance-chart");

    performanceChart = new Chart(chartElement, {
        type: "line",
        data: {
            datasets: [
                {
                    label: "AVG",
                    yAxisID: "yAvg",
                    data: series.map(function (point) {
                        return { x: point.x, y: point.avg, atBats: point.atBats };
                    }),
                    borderColor: "#0d6efd",
                    backgroundColor: "rgba(13, 110, 253, 0.12)",
                    borderWidth: 3,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4
                },
                {
                    label: "OPS",
                    yAxisID: "yOps",
                    data: series.map(function (point) {
                        return { x: point.x, y: point.ops, atBats: point.atBats };
                    }),
                    borderColor: "#fd7e14",
                    backgroundColor: "rgba(253, 126, 20, 0.12)",
                    borderWidth: 3,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "index",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "top"
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return `${context.dataset.label}: ${formatRateNumber(context.parsed.y)}`;
                        },
                        footer: function (tooltipItems) {
                            const point = tooltipItems[0]?.raw;
                            return `ABs in ${PERFORMANCE_ROLLING_DAYS}D window: ${point?.atBats ?? 0}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: "time",
                    time: {
                        unit: determineChartUnit(series),
                        tooltipFormat: "MMM d, yyyy"
                    },
                    title: {
                        display: true,
                        text: "Day"
                    },
                    grid: {
                        display: false
                    }
                },
                yOps: {
                    position: "left",
                    min: opsBounds.min,
                    max: opsBounds.max,
                    title: {
                        display: true,
                        text: "OPS"
                    },
                    ticks: {
                        callback: function (value) {
                            return formatRateNumber(value);
                        }
                    }
                },
                yAvg: {
                    position: "right",
                    min: avgBounds.min,
                    max: avgBounds.max,
                    title: {
                        display: true,
                        text: "AVG"
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        callback: function (value) {
                            return formatRateNumber(value);
                        }
                    }
                }
            }
        }
    });
}

function loadStats() {
    $.ajax({
        url: "/api/stats",
        method: "GET",
        data: getStatsFilterParams(),
        success: function (response) {
            updateStats(response);
        },
        error: function () {
            showMessage("Failed to load stats.", true);
        }
    });
}

function loadEvents() {
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: "/api/events",
        method: "GET",
        data: { limit: historyLimit },
        success: function (response) {
            renderEvents(response.events);
        },
        error: function () {
            showMessage("Failed to load events.", true);
        }
    });
}

function loadPerformanceChart() {
    $.ajax({
        url: "/api/events",
        method: "GET",
        data: { limit: "all" },
        success: function (response) {
            allEventsCache = Array.isArray(response.events) ? response.events : [];
            updateEventsToday(allEventsCache);
            renderPerformanceChart(allEventsCache);
        },
        error: function () {
            showMessage("Failed to load performance chart.", true);
        }
    });
}

function submitEvent() {
    const outcome = getSelectedValue("outcome");
    const difficultyLevel = getSelectedValue("difficulty_level");
    const gameMode = getSelectedValue("game_mode");
    const statsLimit = $("#stats-limit").val();
    const historyLimit = $("#history-limit").val();

    if (!outcome || !difficultyLevel || !gameMode) {
        showMessage("Select an outcome, difficulty level, and game mode.", true);
        return;
    }

    $.ajax({
        url: `/api/events?stats_limit=${encodeURIComponent(statsLimit)}&history_limit=${encodeURIComponent(historyLimit)}`,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            outcome: outcome,
            difficulty_level: difficultyLevel,
            game_mode: gameMode
        }),
        dataType: "json",
        success: function (response) {
            loadStats();
            renderEvents(response.events);
            loadPerformanceChart();
            setSelectedValue("outcome", "");
            showMessage(response.message || "Event recorded.");
        },
        error: function (xhr) {
            const message = xhr.responseJSON?.error || "Failed to record event.";
            showMessage(message, true);
        }
    });
}

function deleteLastEvent() {
    const statsLimit = $("#stats-limit").val();
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: `/api/events/last?stats_limit=${encodeURIComponent(statsLimit)}&history_limit=${encodeURIComponent(historyLimit)}`,
        method: "DELETE",
        success: function (response) {
            loadStats();
            renderEvents(response.events);
            loadPerformanceChart();
            showMessage(response.message || "Last event deleted.");
        },
        error: function (xhr) {
            const message = xhr.responseJSON?.error || "Failed to delete last event.";
            showMessage(message, true);
        }
    });
}

function deleteAllEvents() {
    const statsLimit = $("#stats-limit").val();
    const historyLimit = $("#history-limit").val();

    $.ajax({
        url: `/api/events?stats_limit=${encodeURIComponent(statsLimit)}&history_limit=${encodeURIComponent(historyLimit)}`,
        method: "DELETE",
        success: function (response) {
            loadStats();
            renderEvents(response.events);
            loadPerformanceChart();
            showMessage(response.message || "All events deleted.");
        },
        error: function (xhr) {
            const message = xhr.responseJSON?.error || "Failed to delete all events.";
            showMessage(message, true);
        }
    });
}

$(document).ready(function () {
    bindSelectionButtons();
    syncGoatAvailability();
    loadStats();
    loadEvents();
    loadPerformanceChart();

    $("#submit-event").on("click", function () {
        submitEvent();
    });

    $("#delete-last-event").on("click", function () {
        deleteLastEvent();
    });

    $("#delete-all-events").on("click", function () {
        const confirmed = window.confirm("Delete all recorded events?");
        if (confirmed) {
            deleteAllEvents();
        }
    });

    $("#stats-limit").on("change", function () {
        loadStats();
    });

    $(".stats-filter-checkbox").on("change", function () {
        loadStats();
    });

    $(".filter-select-all").on("click", function () {
        setStatsFilterGroup($(this).attr("data-filter-group"), true);
        loadStats();
    });

    $(".filter-clear-all").on("click", function () {
        setStatsFilterGroup($(this).attr("data-filter-group"), false);
        loadStats();
    });

    $("#history-limit").on("change", function () {
        loadEvents();
    });

    $("#chart-window").on("change", function () {
        renderPerformanceChart(allEventsCache);
    });
});
